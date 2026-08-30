import { WSOL_MINT } from "./constants";

type DexPair = {
  chainId?: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
};

const WSOL = WSOL_MINT.toBase58();

export async function fetchSpotPrices(
  mints: string[],
): Promise<Record<string, number>> {
  const unique = [...new Set(mints.filter(Boolean))];
  const prices: Record<string, number> = {};

  await Promise.all([
    fillDexscreener(unique, prices),
    fillCoinGeckoSol(prices),
  ]);

  return prices;
}

async function fillDexscreener(
  mints: string[],
  prices: Record<string, number>,
) {
  if (mints.length === 0) return;
  // Dexscreener accepts comma-separated mints.
  const chunks: string[][] = [];
  for (let i = 0; i < mints.length; i += 8) {
    chunks.push(mints.slice(i, i + 8));
  }
  for (const chunk of chunks) {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "otc-desk-vaults/1.0" },
        next: { revalidate: 60 },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { pairs?: DexPair[] };
      const best = new Map<string, { price: number; liq: number }>();
      for (const pair of json.pairs ?? []) {
        if (pair.chainId && pair.chainId !== "solana") continue;
        const price = Number(pair.priceUsd);
        if (!Number.isFinite(price) || price <= 0) continue;
        const liq = pair.liquidity?.usd ?? 0;
        const base = pair.baseToken?.address;
        if (base && mints.includes(base)) {
          const prev = best.get(base);
          if (!prev || liq >= prev.liq) best.set(base, { price, liq });
        }
        // Wrapped SOL pairs quote OTC/stocks in SOL.
        const quote = pair.quoteToken?.address;
        if (quote === WSOL && !best.has(WSOL) && pair.baseToken?.symbol) {
          // ignore; SOL priced via CoinGecko + SOL pairs below
        }
        if (base === WSOL) {
          const prev = best.get(WSOL);
          if (!prev || liq >= prev.liq) best.set(WSOL, { price, liq });
        }
      }
      for (const [mint, v] of best) {
        if (prices[mint] == null) prices[mint] = v.price;
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
