import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  CONFIG_EXT_DISCRIMINATOR,
  EXTENDED_TICKER_CAPACITY,
  VAULT_EXT_DISCRIMINATOR,
} from "./constants";
import { decodeConfigExt, decodeVaultExt } from "./decode";

const MINT = new PublicKey("MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump");

describe("extended protocol accounts", () => {
  it("decodes ConfigExt ticker arrays", () => {
    const data = Buffer.alloc(1593);
    CONFIG_EXT_DISCRIMINATOR.copy(data, 0);
    MINT.toBuffer().copy(data, 8);
    const counterOffset = 8 + 32 * EXTENDED_TICKER_CAPACITY;
    data.writeBigUInt64LE(42n, counterOffset);
    const acquiredOffset = counterOffset + 16 * EXTENDED_TICKER_CAPACITY;
    data.writeBigUInt64LE(7n, acquiredOffset);
    const distributedOffset = acquiredOffset + 8 * EXTENDED_TICKER_CAPACITY;
    data.writeBigUInt64LE(5n, distributedOffset);
    const addedAtOffset = distributedOffset + 8 * EXTENDED_TICKER_CAPACITY;
    data.writeBigInt64LE(1_788_102_682n, addedAtOffset);
    data[data.length - 1] = 254;

    const decoded = decodeConfigExt(data);
    assert.equal(decoded.stockMints[0], MINT.toBase58());
    assert.equal(decoded.counter[0], 42n);
    assert.equal(decoded.acquired[0], 7n);
    assert.equal(decoded.distributed[0], 5n);
    assert.equal(decoded.addedAt[0], 1_788_102_682n);
    assert.equal(decoded.bump, 254);
  });

  it("decodes VaultExt stamps and open mask", () => {
    const data = Buffer.alloc(366);
    VAULT_EXT_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(99n, 8);
    const openOffset = 8 + 16 * EXTENDED_TICKER_CAPACITY;
    data.writeUInt32LE(1, openOffset);
    data[openOffset + 4] = 1;
    data[openOffset + 5] = 254;

    const decoded = decodeVaultExt(data);
    assert.equal(decoded.stamp[0], 99n);
    assert.equal(decoded.openAtas, 1);
    assert.equal(decoded.slotCount, 1);
    assert.equal(decoded.bump, 254);
  });
});
