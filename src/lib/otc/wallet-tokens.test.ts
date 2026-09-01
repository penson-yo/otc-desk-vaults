import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  USDC_MINT,
  USDG_MINT,
  WSOL_MINT,
} from "./constants";
import {
  defaultSelectedIds,
  destinationPresets,
  enrichToken,
  isDustToken,
  isLikelyNft,
  knownTokenMeta,
  mergeFungibleTokens,
  nativeSolToken,
  nativeSwapRaw,
  selectDeskTickerIds,
  selectedSwapTotals,
  selectedUsd,
  SOL_SWAP_RESERVE_LAMPORTS,
  sortWalletTokens,
  tokenFromParsed,
  type WalletToken,
} from "./wallet-tokens";

const AAPL = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const WSOL = WSOL_MINT.toBase58();

function token(partial: Partial<WalletToken> & Pick<WalletToken, "id" | "mint">): WalletToken {
  return {
    symbol: partial.symbol ?? "TKN",
    name: partial.name ?? "Token",
    decimals: partial.decimals ?? 6,
    raw: partial.raw ?? "1000000",
    swapRaw: partial.swapRaw ?? partial.raw ?? "1000000",
    amount: partial.amount ?? 1,
    usd: partial.usd ?? 1,
    priceUsd: partial.priceUsd ?? 1,
    isNative: partial.isNative ?? false,
    program: partial.program ?? "spl",
    dust: partial.dust ?? false,
    ...partial,
  };
}

describe("NFT and dust filters", () => {
  it("treats 1 unit of a 0-decimal mint as an NFT", () => {
    assert.equal(isLikelyNft(0, 1n), true);
    assert.equal(isLikelyNft(0, 0n), false);
    assert.equal(isLikelyNft(6, 1n), false);
    assert.equal(isLikelyNft(0, 100n), false);
  });

  it("treats sub-5-cent balances as dust when priced", () => {
    assert.equal(isDustToken(0.049, 12), true);
    assert.equal(isDustToken(0.05, 12), false);
    assert.equal(isDustToken(null, 1), false);
    assert.equal(isDustToken(null, 0), true);
  });
});

describe("native SOL reserve", () => {
  it("keeps 0.02 SOL for fees", () => {
    assert.equal(nativeSwapRaw(50_000_000n), 30_000_000n);
    assert.equal(nativeSwapRaw(SOL_SWAP_RESERVE_LAMPORTS), 0n);
    assert.equal(nativeSwapRaw(10_000_000n), 0n);
  });

  it("builds a native SOL row that Jupiter can wrap", () => {
    const sol = nativeSolToken(80_000_000n, 100);
    assert.equal(sol.id, "native");
    assert.equal(sol.mint, WSOL);
    assert.equal(sol.isNative, true);
    assert.equal(sol.swapRaw, "60000000");
    assert.equal(sol.usd, 8);
  });
});

describe("parsed token accounts", () => {
  it("drops frozen, empty, and NFT accounts", () => {
    assert.equal(
      tokenFromParsed(
        {
          mint: AAPL,
          state: "frozen",
          tokenAmount: { amount: "10", decimals: 8 },
        },
        "spl",
      ),
      null,
    );
    assert.equal(
      tokenFromParsed(
        { mint: AAPL, tokenAmount: { amount: "0", decimals: 8 } },
        "spl",
      ),
      null,
    );
    assert.equal(
      tokenFromParsed(
        { mint: AAPL, tokenAmount: { amount: "1", decimals: 0 } },
        "spl",
      ),
      null,
    );
  });

  it("keeps a fungible Token-2022 balance", () => {
    const parsed = tokenFromParsed(
      {
        mint: USDG_MINT.toBase58(),
        state: "initialized",
        tokenAmount: { amount: "2500000", decimals: 6 },
      },
      "token-2022",
    );
    assert.ok(parsed);
    assert.equal(parsed.amount, 2.5);
    assert.equal(parsed.program, "token-2022");
  });

  it("merges duplicate ATAs but keeps native SOL separate from WSOL", () => {
    const a = tokenFromParsed(
      { mint: AAPL, tokenAmount: { amount: "10", decimals: 8 } },
      "spl",
    )!;
    const b = tokenFromParsed(
      { mint: AAPL, tokenAmount: { amount: "15", decimals: 8 } },
      "spl",
    )!;
    const wsol = tokenFromParsed(
      { mint: WSOL, tokenAmount: { amount: "1000", decimals: 9 } },
      "spl",
    )!;
    const native = {
      id: "native",
      mint: WSOL,
      decimals: 9,
      raw: "2000",
      swapRaw: "2000",
      amount: 0.000002,
      isNative: true as const,
      program: "native" as const,
    };
    const merged = mergeFungibleTokens([a, b, wsol, native]);
    assert.equal(merged.length, 3);
    const apple = merged.find((t) => t.mint === AAPL);
    assert.equal(apple?.raw, "25");
    assert.equal(merged.some((t) => t.isNative), true);
    assert.equal(merged.some((t) => t.mint === WSOL && !t.isNative), true);
  });
});

describe("selection", () => {
  it("skips the output mint, native SOL, and dust by default", () => {
    const tokens = [
      token({ id: "native", mint: WSOL, isNative: true, usd: 20 }),
      token({
        id: AAPL,
        mint: AAPL,
        symbol: "AAPLx",
        usd: 12,
      }),
      token({
        id: "dust",
        mint: "dustMint11111111111111111111111111111111111",
        dust: true,
        usd: 0.01,
      }),
      token({
        id: USDG_MINT.toBase58(),
        mint: USDG_MINT.toBase58(),
        symbol: "USDG",
        usd: 4,
      }),
    ];
    assert.deepEqual(defaultSelectedIds(tokens, USDG_MINT.toBase58()), [AAPL]);
  });

  it("can select only desk tickers", () => {
    const otc = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
    const tokens = [
      token({ id: AAPL, mint: AAPL, symbol: "AAPLx" }),
      token({ id: otc, mint: otc, symbol: "$OTC" }),
      token({ id: "junk", mint: "junkMint11111111111111111111111111111111111" }),
    ];
    assert.deepEqual(selectDeskTickerIds(tokens, USDG_MINT.toBase58(), otc), [
      AAPL,
      otc,
    ]);
  });

  it("builds Jupiter swap totals from the selected set", () => {
    const tokens = [
      nativeSolToken(50_000_000n, 100),
      token({ id: AAPL, mint: AAPL, symbol: "AAPLx", swapRaw: "42", usd: 9 }),
    ];
    const totals = selectedSwapTotals(
      tokens,
      new Set(["native", AAPL]),
      USDG_MINT.toBase58(),
    );
    assert.equal(totals.length, 2);
    assert.equal(totals[0]!.id, "native");
    assert.equal(totals[0]!.raw, 30_000_000n);
    assert.equal(totals[1]!.raw, 42n);
    assert.equal(selectedUsd(tokens, new Set([AAPL])), 9);
  });
});

describe("labels and destinations", () => {
  it("labels known stables and desk tickers", () => {
    assert.equal(knownTokenMeta(USDG_MINT.toBase58())?.symbol, "USDG");
    assert.equal(knownTokenMeta(USDC_MINT.toBase58())?.symbol, "USDC");
    assert.equal(knownTokenMeta(AAPL)?.symbol, "AAPLx");
    assert.equal(
      knownTokenMeta("otcmint111111111111111111111111111111111111", "otcmint111111111111111111111111111111111111")
        ?.symbol,
      "$OTC",
    );
  });

  it("defaults the destination list to USDG", () => {
    const presets = destinationPresets("otcMint");
    assert.equal(presets[0]!.symbol, "USDG");
    assert.equal(presets.map((p) => p.symbol).includes("$OTC"), true);
    assert.equal(presets.map((p) => p.symbol).includes("USDC"), true);
  });

  it("sorts native SOL first, then by USD", () => {
    const sorted = sortWalletTokens([
      token({ id: "b", mint: "b", usd: 2 }),
      nativeSolToken(1_000_000_000n, 10),
      token({ id: "a", mint: "a", usd: 50 }),
    ]);
    assert.equal(sorted[0]!.isNative, true);
    assert.equal(sorted[1]!.usd, 50);
  });

  it("uses Dexscreener labels when the mint is unknown", () => {
    const row = enrichToken(
      {
        id: "unknown",
        mint: "unknownMint11111111111111111111111111111111",
        decimals: 6,
        raw: "1000000",
        swapRaw: "1000000",
        amount: 1,
        isNative: false,
        program: "spl",
      },
      {
        prices: { unknownMint11111111111111111111111111111111: 3 },
        symbols: { unknownMint11111111111111111111111111111111: "BONK" },
        names: { unknownMint11111111111111111111111111111111: "Bonk" },
      },
    );
    assert.equal(row.symbol, "BONK");
    assert.equal(row.usd, 3);
    assert.equal(row.dust, false);
  });
});
