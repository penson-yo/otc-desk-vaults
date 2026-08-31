import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USDG_DECIMALS, USDG_MINT } from "./constants";
import { sumSwapOut, type SwapPreview } from "./jupiter";

describe("USDG swap output", () => {
  it("uses the official Solana mainnet mint", () => {
    assert.equal(
      USDG_MINT.toBase58(),
      "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    );
    assert.equal(USDG_DECIMALS, 6);
  });

  it("formats raw output using the target token decimals", () => {
    const previews = [
      { outAmount: 1_250_000n },
      { outAmount: 250_000n },
      { outAmount: null },
    ] as SwapPreview[];

    assert.equal(sumSwapOut(previews, USDG_DECIMALS), 1.5);
  });
});
