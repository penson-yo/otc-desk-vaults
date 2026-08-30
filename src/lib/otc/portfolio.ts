import { AccountLayout } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  type AccountInfo,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  OTC_DECIMALS,
  PRECISION,
  PROGRAM_ID,
  PUBLIC_RPC,
  RPC_CANDIDATES,
  MPL_CORE_PROGRAM_ID,
  VAULT_DISCRIMINATOR,
  WSOL_MINT,
  stockMeta,
} from "./constants";
import {
  allTickersOpen,
  decodeConfig,
  decodeCoreAssetName,
  decodeVault,
  isDefaultMint,
  tickerOpen,
} from "./decode";
import { uiAmount } from "./format";
import { configPda, solPotPda, vaultPda, vaultStockAta } from "./pda";
import { fetchSpotPrices } from "./prices";
import type {
  DeskHolding,
  PortfolioResponse,
  SlotHolding,
  WalletBreakdown,
  WatchWallet,
} from "./types";
import { estimateYield } from "./yield";

export function connection(rpc = PUBLIC_RPC): Connection {
  return new Connection(rpc, { commitment: "confirmed" });
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String(err);
      const busy =
        msg.includes("429") ||
        msg.includes("Too many") ||
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("fetch failed");
      if (!busy || i === tries - 1) throw err;
      await sleep(400 * 2 ** i + Math.random() * 200);
    }
  }
  throw last;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function tokenAmount(info: AccountInfo<Buffer> | null): bigint {
  if (!info || info.data.length < 72) return 0n;
  try {
    return AccountLayout.decode(Buffer.from(info.data.subarray(0, 165))).amount;
  } catch {
    return 0n;
  }
}

export async function loadPortfolio(
  wallets: WatchWallet[],
  rpc?: string,
): Promise<PortfolioResponse> {
  const candidates = rpc ? [rpc] : RPC_CANDIDATES;
  let last: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i]!;
    try {
      return await loadPortfolioFrom(wallets, url);
    } catch (err) {
      last = err;
      if (i === candidates.length - 1) break;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function loadPortfolioFrom(
  wallets: WatchWallet[],
  rpc: string,
): Promise<PortfolioResponse> {
  const warnings: string[] = [];
  const conn = connection(rpc);
  const cfgKey = configPda();
  const potKey = solPotPda();

  const [cfgInfo, potLamports] = await withRetry(() =>
    Promise.all([
      conn.getAccountInfo(cfgKey),
      conn.getBalance(potKey),
    ]),
  );

  if (!cfgInfo) throw new Error("Config account missing from this RPC.");
  const config = decodeConfig(Buffer.from(cfgInfo.data));
  const tokenMint = new PublicKey(config.tokenMint);
  const collection = new PublicKey(config.collection);
  const activeMints = config.stockMints.filter((m) => !isDefaultMint(m));

  const uniqueWallets = dedupeWallets(wallets);
  const [otcBalances, deskMap, firstMintAt, prices] = await Promise.all([
    fetchOtcBalances(conn, uniqueWallets, tokenMint),
    fetchDesksForWallets(conn, uniqueWallets, collection),
    Promise.race([
      fetchFirstMintAt(conn),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ]),
    fetchSpotPrices([
      WSOL_MINT.toBase58(),
      config.tokenMint,
      ...activeMints,
    ]),
  ]);

  const allDesks = uniqueWallets.flatMap((w) => deskMap.get(w.address) ?? []);
  const vaultKeys = allDesks.map((d) => vaultPda(new PublicKey(d.asset)));
  const vaultInfos = await getMultiple(conn, vaultKeys);

  const stockAtas: PublicKey[] = [];
  for (const vault of vaultKeys) {
    for (const mint of activeMints) {
      stockAtas.push(vaultStockAta(vault, new PublicKey(mint)));
    }
  }
  const ataInfos = await getMultiple(conn, stockAtas);
  const ataAmounts = new Map<string, bigint>();
  stockAtas.forEach((k, i) => {
    ataAmounts.set(k.toBase58(), tokenAmount(ataInfos[i] ?? null));
  });

  const desks: DeskHolding[] = [];
  allDesks.forEach((meta, i) => {
    const info = vaultInfos[i];
    if (!info) {
      warnings.push(`Vault missing for ${meta.name} (${short(meta.asset)}).`);
      return;
    }
    let vault;
    try {
      vault = decodeVault(Buffer.from(info.data));
    } catch (err) {
      warnings.push(`Could not decode vault for ${meta.name}: ${String(err)}`);
      return;
    }
    const vaultKey = vaultKeys[i]!;
    const slots: SlotHolding[] = [];
    let heldUsd = 0;
    let owedUsd = 0;
    activeMints.forEach((mint) => {
      const index = config.stockMints.indexOf(mint);
      const meta = stockMeta(mint);
      const ata = vaultStockAta(vaultKey, new PublicKey(mint));
      const heldRaw = ataAmounts.get(ata.toBase58()) ?? 0n;
      const held = uiAmount(heldRaw, meta.decimals);
      const owedRaw =
        config.counter[index]! > vault.stamp[index]!
          ? (config.counter[index]! - vault.stamp[index]!) / PRECISION
          : 0n;
      const owed = uiAmount(owedRaw, meta.decimals);
      const price = prices[mint] ?? null;
      const usd = price != null ? (held + owed) * price : 0;
      if (price != null) {
        heldUsd += held * price;
        owedUsd += owed * price;
      }
      slots.push({
        index,
        mint,
        symbol: meta.symbol,
        company: meta.company,
        decimals: meta.decimals,
        held,
        owed,
        usd,
        open: tickerOpen(vault.openAtas, index),
        priceUsd: price,
      });
    });

    desks.push({
      asset: meta.asset,
      vault: vaultKey.toBase58(),
      serial: Number(vault.serial),
      name: meta.name || `OTC Desk #${vault.serial}`,
      owner: meta.owner,
      activated: allTickersOpen(vault.openAtas, activeMints.length),
      openMask: vault.openAtas,
      mintedAt: Number(vault.mintedAt),
      depositOtc: uiAmount(vault.deposit, OTC_DECIMALS),
      heldUsd,
      owedUsd,
      slots,
    });
  });

  desks.sort((a, b) => a.serial - b.serial);

  const walletsOut: WalletBreakdown[] = uniqueWallets.map((w) => {
    const owned = desks.filter((d) => d.owner === w.address);
    const otc = otcBalances.get(w.address) ?? 0;
    const otcPrice = prices[config.tokenMint];
    return {
      address: w.address,
      label: w.label,
      otc,
      otcUsd: otcPrice != null ? otc * otcPrice : 0,
      desks: owned.length,
      liveDesks: owned.filter((d) => d.activated).length,
      vaultUsd: owned.reduce((s, d) => s + d.heldUsd, 0),
      owedUsd: owned.reduce((s, d) => s + d.owedUsd, 0),
    };
  });

  const now = Math.floor(Date.now() / 1000);
  const yld = estimateYield({
    config,
    prices,
    firstMintAt,
    now,
  });

  const liveDesks = walletsOut.reduce((s, w) => s + w.liveDesks, 0);
  const apr = yld.apr;
  const mintCostUsd = yld.mintCostUsd;
  const estimatedAnnualUsd =
    yld.status === "ok" &&
    apr != null &&
    mintCostUsd != null
      ? liveDesks * apr * mintCostUsd
      : null;

  const nextMint = config.stockMints[config.roundIndex];
  const nextTicker =
    nextMint && !isDefaultMint(nextMint)
      ? stockMeta(nextMint).symbol
      : "—";

  return {
    fetchedAt: Date.now(),
    rpc,
    protocol: {
      program: PROGRAM_ID.toBase58(),
      config: cfgKey.toBase58(),
      pot: potKey.toBase58(),
      collection: config.collection,
      tokenMint: config.tokenMint,
      protocolWallet: config.protocolWallet,
      minted: Number(config.mintedCount),
      holders: Number(config.holders),
      maxSupply: Number(config.maxSupply),
      potSol: potLamports / 1e9,
      roundThresholdSol: Number(config.roundThreshold) / 1e9,
      nextTicker,
      lastRoundAt: Number(config.lastRoundAt),
      minRoundInterval: Number(config.minRoundInterval),
      depositRequired: uiAmount(config.depositRequired, OTC_DECIMALS),
      surchargeSol: Number(config.surcharge) / 1e9,
      otcBurned: null,
      paidToHoldersUsd: yld.paidToHoldersUsd,
    },
    prices,
    yield: yld,
    wallets: walletsOut,
    desks,
    totals: {
      otc: walletsOut.reduce((s, w) => s + w.otc, 0),
      otcUsd: walletsOut.reduce((s, w) => s + w.otcUsd, 0),
      desks: desks.length,
      liveDesks,
      vaultUsd: walletsOut.reduce((s, w) => s + w.vaultUsd, 0),
      owedUsd: walletsOut.reduce((s, w) => s + w.owedUsd, 0),
      estimatedAnnualUsd,
    },
    warnings,
  };
}

function dedupeWallets(wallets: WatchWallet[]): WatchWallet[] {
  const seen = new Set<string>();
  const out: WatchWallet[] = [];
  for (const w of wallets) {
    try {
      const pk = new PublicKey(w.address).toBase58();
      if (seen.has(pk)) continue;
      seen.add(pk);
      out.push({ address: pk, label: w.label.trim() || short(pk) });
    } catch {
      // skip invalid
    }
  }
  return out;
}

async function fetchOtcBalances(
  conn: Connection,
  wallets: WatchWallet[],
  mint: PublicKey,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  await Promise.all(
    wallets.map(async (w) => {
      const owner = new PublicKey(w.address);
      const res = await withRetry(() =>
        conn.getTokenAccountsByOwner(owner, { mint }),
      );
      let raw = 0n;
      for (const acc of res.value) {
        raw += tokenAmount(acc.account);
      }
      map.set(w.address, uiAmount(raw, OTC_DECIMALS));
    }),
  );
  return map;
}

async function fetchDesksForWallets(
  conn: Connection,
  wallets: WatchWallet[],
  collection: PublicKey,
): Promise<Map<string, { asset: string; owner: string; name: string }[]>> {
  const map = new Map<string, { asset: string; owner: string; name: string }[]>();
  await Promise.all(
    wallets.map(async (w) => {
      const owner = new PublicKey(w.address);
      const accounts = await withRetry(() =>
        conn.getProgramAccounts(MPL_CORE_PROGRAM_ID, {
          filters: [
            { memcmp: { offset: 1, bytes: owner.toBase58() } },
            { memcmp: { offset: 34, bytes: collection.toBase58() } },
          ],
        }),
      );
      const desks = accounts.map((acc) => {
        const parsed = decodeCoreAssetName(Buffer.from(acc.account.data));
        return {
          asset: acc.pubkey.toBase58(),
          owner: parsed.owner,
          name: parsed.name,
        };
      });
      map.set(w.address, desks);
    }),
  );
  return map;
}

async function fetchFirstMintAt(conn: Connection): Promise<number | null> {
  try {
    const accounts = await withRetry(() =>
      conn.getProgramAccounts(PROGRAM_ID, {
        dataSlice: { offset: 176, length: 8 },
        filters: [
          { memcmp: { offset: 0, bytes: bs58.encode(VAULT_DISCRIMINATOR) } },
        ],
      }),
    );
    let min = 0n;
    for (const { account } of accounts) {
      if (account.data.length !== 8) continue;
      const ts = Buffer.from(account.data).readBigInt64LE(0);
      if (ts > 0n && (min === 0n || ts < min)) min = ts;
    }
    return min === 0n ? null : Number(min);
  } catch {
    return null;
  }
}

async function getMultiple(
  conn: Connection,
  keys: PublicKey[],
): Promise<(AccountInfo<Buffer> | null)[]> {
  const out: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const slice = keys.slice(i, i + 100);
    if (slice.length === 0) continue;
    const infos = await withRetry(() => conn.getMultipleAccountsInfo(slice));
    out.push(...infos);
  }
  return out;
}

function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function parseAddressList(input: string): string[] {
  const parts = input
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    try {
      const pk = new PublicKey(p).toBase58();
      if (seen.has(pk)) continue;
      seen.add(pk);
      out.push(pk);
    } catch {
      // skip
    }
  }
  return out;
}
