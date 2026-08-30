import { Connection } from "@solana/web3.js";
import {
  MAGIC_EDEN_COLLECTION_SYMBOL,
  RPC_CANDIDATES,
  WSOL_MINT,
} from "./constants";
import { decodeConfig } from "./decode";
import { configPda } from "./pda";
import { fetchSpotQuotes } from "./prices";
import type { MarketSnapshot } from "./types";

const WSOL = WSOL_MINT.toBase58();

export function floorSolFromLamports(
  lamports: number | null | undefined,
): number | null {
  if (lamports == null || !Number.isFinite(lamports) || lamports <= 0) {
    return null;
  }
  return lamports / 1e9;
}

export async function loadMarket(): Promise<MarketSnapshot> {
  const [floor, mint] = await Promise.all([
    fetchNftFloor(),
    fetchTokenMint(),
  ]);

  const quotes = await fetchSpotQuotes(
    mint ? [WSOL, mint] : [WSOL],
  );

  if (mint && quotes.marketCaps[mint] == null) {
    await fillJupiterMcap(mint, quotes.marketCaps, quotes.prices);
  }

  const solUsd = quotes.prices[WSOL] ?? null;
  const nftFloorSol = floor.sol;
  const nftFloorUsd =
    nftFloorSol != null && solUsd != null ? nftFloorSol * solUsd : null;

  return {
    fetchedAt: Date.now(),
    otcMint: mint,
    otcPriceUsd: mint ? (quotes.prices[mint] ?? null) : null,
    otcMarketCapUsd: mint ? (quotes.marketCaps[mint] ?? null) : null,
    nftFloorSol,
    nftFloorUsd,
    listedCount: floor.listedCount,
    collectionSymbol: floor.symbol,
  };
}

export async function fetchNftFloor(
  symbol = MAGIC_EDEN_COLLECTION_SYMBOL,
): Promise<{
  sol: number | null;
  listedCount: number | null;
  symbol: string;
}> {
  try {
    const res = await fetch(
      `https://api-mainnet.magiceden.dev/v2/collections/${symbol}/stats`,
      {
        headers: { "user-agent": "otc-desk-vaults/1.0" },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) {
      return { sol: null, listedCount: null, symbol };
    }
    const json = (await res.json()) as {
      floorPrice?: number;
      listedCount?: number;
      symbol?: string;
    };
    return {
      sol: floorSolFromLamports(json.floorPrice),
      listedCount:
        json.listedCount != null && Number.isFinite(json.listedCount)
          ? json.listedCount
          : null,
      symbol: json.symbol || symbol,
    };
  } catch {
    return { sol: null, listedCount: null, symbol };
  }
}

async function fetchTokenMint(): Promise<string | null> {
  for (const rpc of RPC_CANDIDATES) {
    try {
      const conn = new Connection(rpc, { commitment: "confirmed" });
      const info = await conn.getAccountInfo(configPda());
      if (!info) continue;
      return decodeConfig(Buffer.from(info.data)).tokenMint;
    } catch {
      // try the next RPC
    }
  }
  return null;
}

async function fillJupiterMcap(
  mint: string,
  marketCaps: Record<string, number>,
  prices: Record<string, number>,
) {
  try {
    const res = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      {
        headers: { "user-agent": "otc-desk-vaults/1.0" },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return;
    const json = (await res.json()) as Array<{
      id?: string;
      mcap?: number;
      fdv?: number;
      usdPrice?: number;
    }>;
    const hit = json.find((row) => row.id === mint) ?? json[0];
    if (!hit) return;
    const cap = Number(hit.mcap ?? hit.fdv);
    if (Number.isFinite(cap) && cap > 0 && marketCaps[mint] == null) {
      marketCaps[mint] = cap;
    }
    const price = Number(hit.usdPrice);
    if (Number.isFinite(price) && price > 0 && prices[mint] == null) {
      prices[mint] = price;
    }
  } catch {
    // ignore
  }
}
