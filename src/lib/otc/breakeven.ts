import {
  PublicKey,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  MAGIC_EDEN_COLLECTION_SYMBOL,
  RPC_CANDIDATES,
  WSOL_MINT,
  stockMeta,
} from "./constants";
import { connection, loadPortfolio } from "./portfolio";
import { userStockAta } from "./pda";
import type {
  BreakEvenResponse,
  ClaimedReward,
  DeskBreakEven,
  DeskHolding,
  PortfolioResponse,
  WatchWallet,
} from "./types";

const MAGIC_EDEN_API = "https://api-mainnet.magiceden.dev/v2";
const DAY_SECONDS = 86_400;
const MAX_SIGNATURES = 1_000;

/** Claim history can change immediately after a wallet transaction. */
export const BREAK_EVEN_CACHE_CONTROL = "no-store";

export type MagicEdenActivity = {
  signature?: string;
  type?: string;
  source?: string;
  tokenMint?: string;
  collection?: string;
  collectionSymbol?: string;
  blockTime?: number;
  buyer?: string;
  price?: number;
};

export type MagicEdenPool = {
  poolKey?: string;
  spotPrice?: number;
  buyPriceTaker?: number;
  expiry?: number;
  buyOrdersAmount?: number;
  buysidePaymentAmount?: number;
  curveDelta?: number;
};

export type DeskPurchase = {
  wallet: string;
  asset: string;
  vault: string;
  serial: number;
  purchasedAt: number;
  costSol: number;
};

type ClaimedAmount = {
  serial: number;
  mint: string;
  amount: number;
};

export type ExitBidAssignment = {
  asset: string;
  poolKey: string;
  grossSol: number;
  netSol: number;
  expiresAt: number | null;
};

export function matchCurrentPurchases(args: {
  wallet: string;
  desks: DeskHolding[];
  activities: MagicEdenActivity[];
}): DeskPurchase[] {
  const assets = new Map(args.desks.map((desk) => [desk.asset, desk]));
  const latest = new Map<string, MagicEdenActivity>();

  for (const activity of args.activities) {
    if (
      activity.type !== "buyNow" ||
      activity.collectionSymbol !== MAGIC_EDEN_COLLECTION_SYMBOL ||
      activity.buyer !== args.wallet ||
      !activity.tokenMint ||
      !assets.has(activity.tokenMint) ||
      !Number.isFinite(activity.blockTime) ||
      !Number.isFinite(activity.price) ||
      Number(activity.price) <= 0
    ) {
      continue;
    }
    const previous = latest.get(activity.tokenMint);
    if ((activity.blockTime ?? 0) > (previous?.blockTime ?? 0)) {
      latest.set(activity.tokenMint, activity);
    }
  }

  return [...latest.entries()].map(([asset, activity]) => {
    const desk = assets.get(asset)!;
    return {
      wallet: args.wallet,
      asset,
      vault: desk.vault,
      serial: desk.serial,
      purchasedAt: Number(activity.blockTime),
      costSol: Number(activity.price),
    };
  });
}

export function calculateBreakEven(args: {
  portfolio: PortfolioResponse;
  purchases: DeskPurchase[];
  claimed: ClaimedAmount[];
  bidsByAsset?: Map<string, MagicEdenPool[]>;
  now: number;
  warnings?: string[];
}): BreakEvenResponse {
  const warnings = [...(args.warnings ?? [])];
  const solUsd = args.portfolio.prices[WSOL_MINT.toBase58()] ?? null;
  const floorSol = args.portfolio.protocol.nftFloorSol;
  const floorUsdPerDesk = args.portfolio.protocol.nftFloorUsd;
  const desksByAsset = new Map(
    args.portfolio.desks.map((desk) => [desk.asset, desk]),
  );
  const claimedByDesk = new Map<number, Map<string, number>>();
  const exitAssignments = assignInstantExitBids({
    assets: args.purchases.map((purchase) => purchase.asset),
    bidsByAsset: args.bidsByAsset ?? new Map(),
    now: args.now,
  });
  const exitByAsset = new Map(
    exitAssignments.map((assignment) => [assignment.asset, assignment]),
  );

  for (const item of args.claimed) {
    const byMint = claimedByDesk.get(item.serial) ?? new Map<string, number>();
    byMint.set(item.mint, (byMint.get(item.mint) ?? 0) + item.amount);
    claimedByDesk.set(item.serial, byMint);
  }

  const desks: DeskBreakEven[] = args.purchases
    .map((purchase) => {
      const holding = desksByAsset.get(purchase.asset);
      if (!holding) return null;
      const rewards: ClaimedReward[] = [];
      for (const [mint, amount] of claimedByDesk.get(purchase.serial) ?? []) {
        const price = args.portfolio.prices[mint];
        if (price == null) {
          warnings.push(
            `Missing a current price for ${stockMeta(mint, args.portfolio.protocol.tokenMint).symbol}; claimed value is understated.`,
          );
        }
        rewards.push({
          mint,
          symbol: stockMeta(mint, args.portfolio.protocol.tokenMint).symbol,
          amount,
          usd: amount * (price ?? 0),
        });
      }
      rewards.sort((a, b) => a.symbol.localeCompare(b.symbol));
      const claimedRewardsUsd = rewards.reduce((sum, item) => sum + item.usd, 0);
      const unclaimedRewardsUsd = holding.heldUsd + holding.owedUsd;
      const totalRewardsUsd = claimedRewardsUsd + unclaimedRewardsUsd;
      const costUsd = solUsd == null ? 0 : purchase.costSol * solUsd;
      const validBids = validPools(
        args.bidsByAsset?.get(purchase.asset) ?? [],
        args.now,
      );
      const bestBid = validBids[0];
      const assignedExit = exitByAsset.get(purchase.asset);
      const economicPnlUsd =
        solUsd == null || floorUsdPerDesk == null
          ? null
          : floorUsdPerDesk + totalRewardsUsd - costUsd;

      return {
        ...purchase,
        costUsd,
        floorUsd: floorUsdPerDesk,
        claimedRewardsUsd,
        unclaimedRewardsUsd,
        totalRewardsUsd,
        economicPnlUsd,
        bestBidSol:
          bestBid?.spotPrice == null ? null : bestBid.spotPrice / 1e9,
        bestBidNetSol:
          bestBid?.buyPriceTaker == null ? null : bestBid.buyPriceTaker / 1e9,
        bestBidExpiresAt:
          bestBid?.expiry && bestBid.expiry > 0 ? bestBid.expiry : null,
        assignedExitNetSol: assignedExit?.netSol ?? null,
        rewards,
      };
    })
    .filter((desk): desk is DeskBreakEven => desk !== null)
    .sort((a, b) => a.serial - b.serial);

  const costBasisSol = desks.reduce((sum, desk) => sum + desk.costSol, 0);
  const costBasisUsd = desks.reduce((sum, desk) => sum + desk.costUsd, 0);
  const claimedRewardsUsd = desks.reduce(
    (sum, desk) => sum + desk.claimedRewardsUsd,
    0,
  );
  const unclaimedRewardsUsd = desks.reduce(
    (sum, desk) => sum + desk.unclaimedRewardsUsd,
    0,
  );
  const totalRewardsUsd = claimedRewardsUsd + unclaimedRewardsUsd;
  const floorValueSol = floorSol == null ? null : floorSol * desks.length;
  const floorValueUsd =
    floorUsdPerDesk == null ? null : floorUsdPerDesk * desks.length;
  const instantExitDesks = exitAssignments.length;
  const instantExitSol =
    instantExitDesks === 0
      ? null
      : exitAssignments.reduce((sum, assignment) => sum + assignment.netSol, 0);
  const instantExitUsd =
    instantExitSol == null || solUsd == null ? null : instantExitSol * solUsd;
  const economicPnlUsd =
    floorValueUsd == null || solUsd == null
      ? null
      : floorValueUsd + totalRewardsUsd - costBasisUsd;
  const instantExitEconomicPnlUsd =
    instantExitUsd == null || instantExitDesks < desks.length
      ? null
      : instantExitUsd + totalRewardsUsd - costBasisUsd;
  const rewardsOnlyRemainingUsd = Math.max(0, costBasisUsd - totalRewardsUsd);
  const deskDays = desks.reduce(
    (sum, desk) => sum + Math.max(0, args.now - desk.purchasedAt) / DAY_SECONDS,
    0,
  );
  const dailyRewardsUsd =
    deskDays >= 1 && desks.length > 0
      ? (totalRewardsUsd / deskDays) * desks.length
      : null;
  const rewardsOnlyEtaDays =
    rewardsOnlyRemainingUsd === 0
      ? 0
      : dailyRewardsUsd != null && dailyRewardsUsd > 0
        ? rewardsOnlyRemainingUsd / dailyRewardsUsd
        : null;
  const currentDesks = args.portfolio.desks.length;
  const status =
    desks.length === 0
      ? "unavailable"
      : desks.length < currentDesks || warnings.length > 0
        ? "partial"
        : "ok";

  return {
    fetchedAt: args.now * 1_000,
    status,
    basisDesks: desks.length,
    currentDesks,
    costBasisSol,
    costBasisUsd,
    floorValueSol,
    floorValueUsd,
    instantExitSol,
    instantExitUsd,
    instantExitEconomicPnlUsd,
    instantExitDesks,
    claimedRewardsUsd,
    unclaimedRewardsUsd,
    totalRewardsUsd,
    economicPnlUsd,
    rewardsOnlyRemainingUsd,
    dailyRewardsUsd,
    rewardsOnlyEtaDays,
    deskDays,
    desks,
    warnings: [...new Set(warnings)],
    methodology:
      "Magic Eden buyNow cost basis. Claimed vault transfers and current vault stock are marked at current spot prices. Floor value and the since-purchase reward rate are estimates, not realized profit or a forecast.",
  };
}

export function assignInstantExitBids(args: {
  assets: string[];
  bidsByAsset: Map<string, MagicEdenPool[]>;
  now: number;
}): ExitBidAssignment[] {
  const choices = args.assets.map((asset) =>
    validPools(args.bidsByAsset.get(asset) ?? [], args.now).map((pool) => ({
      asset,
      poolKey: pool.poolKey!,
      grossSol: pool.spotPrice! / 1e9,
      netSol: pool.buyPriceTaker! / 1e9,
      expiresAt: pool.expiry && pool.expiry > 0 ? pool.expiry : null,
      capacity: poolCapacity(pool),
    })),
  );
  const capacities = new Map<string, number>();
  for (const offers of choices) {
    for (const offer of offers) {
      capacities.set(
        offer.poolKey,
        Math.max(capacities.get(offer.poolKey) ?? 0, offer.capacity),
      );
    }
  }

  // The exact search is small for normal wallets, but its combinations grow
  // quickly. Use a conservative capacity-aware assignment for large watchlists.
  if (choices.length > 10) {
    const assignedAssets = new Set<string>();
    const usedPools = new Map<string, number>();
    return choices
      .flat()
      .sort((a, b) => b.netSol - a.netSol)
      .flatMap((offer) => {
        if (assignedAssets.has(offer.asset)) return [];
        const used = usedPools.get(offer.poolKey) ?? 0;
        if (used >= (capacities.get(offer.poolKey) ?? 0)) return [];
        assignedAssets.add(offer.asset);
        usedPools.set(offer.poolKey, used + 1);
        return [
          {
            asset: offer.asset,
            poolKey: offer.poolKey,
            grossSol: offer.grossSol,
            netSol: offer.netSol,
            expiresAt: offer.expiresAt,
          },
        ];
      });
  }

  const used = new Map<string, number>();
  let bestTotal = -1;
  let best: ExitBidAssignment[] = [];

  const walk = (index: number, total: number, assigned: ExitBidAssignment[]) => {
    if (index === choices.length) {
      if (total > bestTotal) {
        bestTotal = total;
        best = [...assigned];
      }
      return;
    }
    walk(index + 1, total, assigned);
    for (const offer of choices[index]!) {
      const count = used.get(offer.poolKey) ?? 0;
      if (count >= (capacities.get(offer.poolKey) ?? 0)) continue;
      used.set(offer.poolKey, count + 1);
      assigned.push({
        asset: offer.asset,
        poolKey: offer.poolKey,
        grossSol: offer.grossSol,
        netSol: offer.netSol,
        expiresAt: offer.expiresAt,
      });
      walk(index + 1, total + offer.netSol, assigned);
      assigned.pop();
      if (count === 0) used.delete(offer.poolKey);
      else used.set(offer.poolKey, count);
    }
  };

  walk(0, 0, []);
  return best;
}

function validPools(pools: MagicEdenPool[], now: number): MagicEdenPool[] {
  return pools
    .filter(
      (pool) =>
        !!pool.poolKey &&
        Number(pool.spotPrice) > 0 &&
        Number(pool.buyPriceTaker) > 0 &&
        Number(pool.buyOrdersAmount) > 0 &&
        (!pool.expiry || pool.expiry === 0 || pool.expiry > now + 30),
    )
    .sort(
      (a, b) => Number(b.buyPriceTaker) - Number(a.buyPriceTaker),
    );
}

function poolCapacity(pool: MagicEdenPool): number {
  const orderCapacity = Math.max(0, Math.floor(Number(pool.buyOrdersAmount)));
  const gross = Number(pool.spotPrice);
  const fundedCapacity =
    gross > 0
      ? Math.max(0, Math.floor(Number(pool.buysidePaymentAmount) / gross))
      : 0;
  const flatCurveCapacity = Number(pool.curveDelta) === 0 ? orderCapacity : 1;
  return Math.max(0, Math.min(flatCurveCapacity, fundedCapacity || orderCapacity));
}

export async function loadBreakEven(
  wallets: WatchWallet[],
): Promise<BreakEvenResponse> {
  const portfolio = await loadPortfolio(wallets);
  const warnings: string[] = [];
  const purchases: DeskPurchase[] = [];

  for (const wallet of portfolio.wallets) {
    const desks = portfolio.desks.filter((desk) => desk.owner === wallet.address);
    if (desks.length === 0) continue;
    try {
      const activities = await fetchMagicEdenActivities(wallet.address);
      const matched = matchCurrentPurchases({
        wallet: wallet.address,
        desks,
        activities,
      });
      purchases.push(...matched);
      if (matched.length < desks.length) {
        warnings.push(
          `${desks.length - matched.length} desk${desks.length - matched.length === 1 ? " has" : "s have"} no Magic Eden buyNow basis in the latest 500 wallet activities.`,
        );
      }
    } catch (err) {
      warnings.push(
        `Magic Eden cost basis failed for ${wallet.label}: ${errorMessage(err)}`,
      );
    }
  }

  const claimed: ClaimedAmount[] = [];
  const bidsByAsset = new Map<string, MagicEdenPool[]>();
  for (const purchase of purchases) {
    try {
      bidsByAsset.set(
        purchase.asset,
        await fetchMagicEdenPools(purchase.asset),
      );
    } catch (err) {
      warnings.push(
        `Magic Eden bids failed for #${purchase.serial}: ${errorMessage(err)}`,
      );
    }
    await sleep(550);
  }
  for (const wallet of portfolio.wallets) {
    const walletPurchases = purchases.filter(
      (purchase) => purchase.wallet === wallet.address,
    );
    if (walletPurchases.length === 0) continue;
    try {
      const historyRpcs = [...new Set([...RPC_CANDIDATES, portfolio.rpc])];
      let result: Awaited<ReturnType<typeof scanClaimedRewards>> | null = null;
      let last: unknown;
      for (const rpc of historyRpcs) {
        try {
          result = await scanClaimedRewards({
            wallet: wallet.address,
            purchases: walletPurchases,
            rewardMints: [
              ...new Set(
                portfolio.desks
                  .filter((desk) => desk.owner === wallet.address)
                  .flatMap((desk) => desk.slots.map((slot) => slot.mint)),
              ),
            ],
            conn: connection(rpc),
          });
          break;
        } catch (err) {
          last = err;
        }
      }
      if (!result) throw last;
      claimed.push(...result.claimed);
      warnings.push(...result.warnings);
    } catch (err) {
      warnings.push(
        `Claim history failed for ${wallet.label}: ${errorMessage(err)}`,
      );
    }
  }

  return calculateBreakEven({
    portfolio,
    purchases,
    claimed,
    bidsByAsset,
    now: Math.floor(Date.now() / 1_000),
    warnings,
  });
}

async function fetchMagicEdenPools(asset: string): Promise<MagicEdenPool[]> {
  const response = await fetch(
    `${MAGIC_EDEN_API}/mmm/token/${asset}/pools?limit=5`,
    {
      headers: { "user-agent": "otc-desk-vaults/1.0" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = (await response.json()) as { results?: unknown };
  if (!Array.isArray(json.results)) throw new Error("Unexpected bid response");
  return json.results as MagicEdenPool[];
}

async function fetchMagicEdenActivities(
  wallet: string,
): Promise<MagicEdenActivity[]> {
  const response = await fetch(
    `${MAGIC_EDEN_API}/wallets/${wallet}/activities?offset=0&limit=500`,
    {
      headers: { "user-agent": "otc-desk-vaults/1.0" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error("Unexpected activity response");
  return json as MagicEdenActivity[];
}

async function scanClaimedRewards(args: {
  wallet: string;
  purchases: DeskPurchase[];
  rewardMints: string[];
  conn: ReturnType<typeof connection>;
}): Promise<{ claimed: ClaimedAmount[]; warnings: string[] }> {
  const warnings: string[] = [];
  const earliest = Math.min(
    ...args.purchases.map((purchase) => purchase.purchasedAt),
  );
  const walletKey = new PublicKey(args.wallet);
  const relevantBySignature = new Map<
    string,
    { signature: string; blockTime?: number | null }
  >();
  for (const mint of args.rewardMints) {
    const tokenAccount = userStockAta(walletKey, new PublicKey(mint));
    const signatures = await rpcRetry(() =>
      args.conn.getSignaturesForAddress(
        tokenAccount,
        { limit: MAX_SIGNATURES },
        "confirmed",
      ),
    );
    for (const item of signatures) {
      if (!item.err && (item.blockTime ?? 0) >= earliest) {
        relevantBySignature.set(item.signature, item);
      }
    }
    if (
      signatures.length === MAX_SIGNATURES &&
      (signatures.at(-1)?.blockTime ?? 0) >= earliest
    ) {
      warnings.push(
        `Claim history for ${stockMeta(mint).symbol} was truncated at ${MAX_SIGNATURES} transactions.`,
      );
    }
    await sleep(75);
  }
  const relevant = [...relevantBySignature.values()].sort(
    (a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0),
  );

  const transactions: (ParsedTransactionWithMeta | null)[] = [];
  const paceMs = args.conn.rpcEndpoint.includes("publicnode.com") ? 200 : 350;
  for (const item of relevant) {
    const parsed = await rpcRetry(() =>
      args.conn.getParsedTransaction(item.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }),
    );
    transactions.push(parsed);
    await sleep(paceMs);
  }

  const byVault = new Map(
    args.purchases.map((purchase) => [purchase.vault, purchase]),
  );
  const totals = new Map<string, ClaimedAmount>();
  for (const transaction of transactions) {
    if (!transaction?.meta || transaction.meta.err) continue;
    const accountKeys = transaction.transaction.message.accountKeys.map((key) =>
      key.pubkey.toBase58(),
    );
    const destinationOwners = new Map<string, string>();
    for (const balance of [
      ...(transaction.meta.preTokenBalances ?? []),
      ...(transaction.meta.postTokenBalances ?? []),
    ]) {
      const account = accountKeys[balance.accountIndex];
      if (account && balance.owner) destinationOwners.set(account, balance.owner);
    }

    for (const group of transaction.meta.innerInstructions ?? []) {
      for (const instruction of group.instructions) {
        if (!("parsed" in instruction)) continue;
        if (instruction.parsed.type !== "transferChecked") continue;
        const info = instruction.parsed.info as {
          authority?: string;
          destination?: string;
          mint?: string;
          tokenAmount?: { uiAmountString?: string };
        };
        const purchase = info.authority ? byVault.get(info.authority) : undefined;
        if (
          !purchase ||
          !info.destination ||
          destinationOwners.get(info.destination) !== purchase.wallet ||
          !info.mint ||
          (transaction.blockTime ?? 0) < purchase.purchasedAt
        ) {
          continue;
        }
        const amount = Number(info.tokenAmount?.uiAmountString ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const key = `${purchase.serial}:${info.mint}`;
        const previous = totals.get(key);
        totals.set(key, {
          serial: purchase.serial,
          mint: info.mint,
          amount: (previous?.amount ?? 0) + amount,
        });
      }
    }
  }

  return { claimed: [...totals.values()], warnings };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function rpcRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const message = errorMessage(err).toLowerCase();
      const retryable =
        message.includes("429") ||
        message.includes("too many") ||
        message.includes("503") ||
        message.includes("502") ||
        message.includes("fetch failed");
      if (!retryable || attempt === tries - 1) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw last;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
