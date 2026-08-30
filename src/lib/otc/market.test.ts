import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floorSolFromLamports } from "./market";
import { capFromPair, pickBestDexQuote, type DexPair } from "./prices";
import { fmtCompactUsd } from "./format";

const OTC = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";

describe("floorSolFromLamports", () => {
  it("converts Magic Eden lamports to SOL", () => {
    assert.equal(floorSolFromLamports(1_098_000_000), 1.098);
  });

  it("treats missing or non-positive floors as empty", () => {
    assert.equal(floorSolFromLamports(null), null);
    assert.equal(floorSolFromLamports(0), null);
    assert.equal(floorSolFromLamports(Number.NaN), null);
  });
});

describe("pickBestDexQuote", () => {
  it("uses the highest-liquidity Solana pair for market cap", () => {
    const pairs: DexPair[] = [
      {
        chainId: "solana",
        baseToken: { address: OTC, symbol: "OTC" },
        priceUsd: "0.0013",
        liquidity: { usd: 20_000 },
        marketCap: 1_290_000,
      },
      {
        chainId: "solana",
        baseToken: { address: OTC, symbol: "OTC" },
        priceUsd: "0.00134",
        liquidity: { usd: 128_000 },
        marketCap: 1_016_892,
      },
      {
        chainId: "ethereum",
        baseToken: { address: OTC, symbol: "OTC" },
        priceUsd: "9",
        liquidity: { usd: 9_000_000 },
        marketCap: 99_000_000,
      },
    ];
    const best = pickBestDexQuote(OTC, pairs);
    assert.ok(best);
    assert.equal(best.marketCap, 1_016_892);
    assert.equal(best.price, 0.00134);
  });

  it("falls back to fdv when marketCap is missing", () => {
    assert.equal(capFromPair({ fdv: 500_000 }), 500_000);
    assert.equal(capFromPair({ marketCap: 0, fdv: 12 }), 12);
  });

  it("ignores pairs for other mints", () => {
    const pairs: DexPair[] = [
      {
        chainId: "solana",
        baseToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
        priceUsd: "100",
        liquidity: { usd: 50_000_000 },
        marketCap: 50_000_000_000,
      },
      {
        chainId: "solana",
        baseToken: { address: OTC, symbol: "OTC" },
        priceUsd: "0.001",
        liquidity: { usd: 1_000 },
        marketCap: 900_000,
      },
    ];
    const best = pickBestDexQuote(OTC, pairs);
    assert.equal(best?.marketCap, 900_000);
  });
});

describe("fmtCompactUsd", () => {
  it("compacts millions for a glanceable market cap", () => {
    assert.equal(fmtCompactUsd(1_016_892), "$1.02M");
    assert.equal(fmtCompactUsd(null), "—");
  });
});
