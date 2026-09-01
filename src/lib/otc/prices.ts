import { WSOL_MINT } from "./constants";

export type DexPair = {
  chainId?: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
};

const WSOL = WSOL_MINT.toBase58();

export type SpotQuotes = {
  prices: Record<string, number>;
  marketCaps: Record<string, number>;
};

export async function fetchSpotPrices(
  mints: string[],
): Promise<Record<string, number>> {
  return (await fetchSpotQuotes(mints)).prices;
}

export async function fetchSpotQuotes(mints: string[]): Promise<SpotQuotes> {
  const unique = [...new Set(mints.filter(Boolean))];
  const prices: Record<string, number> = {};
  const marketCaps: Record<string, number> = {};

  await Promise.all([
    fillDexscreener(unique, prices, marketCaps),
    fillCoinGeckoSol(prices),
  ]);

  return { prices, marketCaps };
}

export function pickBestDexQuote(
  mint: string,
  pairs: DexPair[],
): { price: number; marketCap: number | null; liq: number } | null {
  let best: { price: number; marketCap: number | null; liq: number } | null =
    null;
  for (const pair of pairs) {
    if (pair.chainId && pair.chainId !== "solana") continue;
    const price = Number(pair.priceUsd);
    if (!Number.isFinite(price) || price <= 0) continue;
    const liq = pair.liquidity?.usd ?? 0;
    const base = pair.baseToken?.address;
    const isMint = base === mint;
    const isWsol = mint === WSOL && base === WSOL;
    if (!isMint && !isWsol) continue;
    const marketCap = capFromPair(pair);
    if (!best || liq >= best.liq) {
      best = { price, marketCap, liq };
    }
  }
  return best;
}

export function capFromPair(pair: DexPair): number | null {
  const cap = Number(pair.marketCap);
  if (Number.isFinite(cap) && cap > 0) return cap;
  return null;
}

async function fillDexscreener(
  mints: string[],
  prices: Record<string, number>,
  marketCaps: Record<string, number>,
) {
  if (mints.length === 0) return;
  // WSOL has so many pairs that batching it with other mints crowds
  // the Dexscreener response and drops the real OTC pool.
  const tokenMints = mints.filter((m) => m !== WSOL);
  const chunks: string[][] = [];
  for (let i = 0; i < tokenMints.length; i += 8) {
    chunks.push(tokenMints.slice(i, i + 8));
  }
  if (mints.includes(WSOL)) chunks.push([WSOL]);
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "otc-desk-vaults/1.0" },
        next: { revalidate: 60 },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { pairs?: DexPair[] };
      const pairs = json.pairs ?? [];
      for (const mint of chunk) {
        const best = pickBestDexQuote(mint, pairs);
        if (!best) continue;
        if (prices[mint] == null) prices[mint] = best.price;
        if (best.marketCap != null && marketCaps[mint] == null) {
          marketCaps[mint] = best.marketCap;
        }
      }
    } catch {
      // Price feed is best-effort; yield layer explains gaps.
    }
  }
}

async function fillCoinGeckoSol(prices: Record<string, number>) {
  if (prices[WSOL] != null) return;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      {
        headers: { "user-agent": "otc-desk-vaults/1.0" },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return;
    const json = (await res.json()) as { solana?: { usd?: number } };
    const usd = json.solana?.usd;
    if (usd && Number.isFinite(usd)) prices[WSOL] = usd;
  } catch {
    // ignore
  }
}
