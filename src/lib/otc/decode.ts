import { PublicKey } from "@solana/web3.js";
import {
  CONFIG_EXT_DISCRIMINATOR,
  EXTENDED_TICKER_CAPACITY,
  CONFIG_DISCRIMINATOR,
  TICKER_COUNT,
  VAULT_EXT_DISCRIMINATOR,
  VAULT_DISCRIMINATOR,
} from "./constants";

export type OtcConfig = {
  authority: string;
  protocolWallet: string;
  collection: string;
  namePrefix: string;
  baseUri: string;
  tokenMint: string;
  stockMints: string[];
  counter: bigint[];
  acquired: bigint[];
  distributed: bigint[];
  holders: bigint;
  maxSupply: bigint;
  mintedCount: bigint;
  roundIndex: number;
  roundThreshold: bigint;
  lastRoundAt: bigint;
  pendingLamports: bigint;
  pendingPoolBefore: bigint;
  pendingIndex: number;
  minRoundInterval: bigint;
  depositRequired: bigint;
  surcharge: bigint;
  protocolShareBps: number;
  withdrawFeeLamports: bigint;
  withdrawFeeFloorLamports: bigint;
  withdrawFeeDecaySeconds: bigint;
  withdrawFeeStepSeconds: bigint;
  royaltyBps: number;
  solPotBump: number;
  bump: number;
};

export type OtcVault = {
  stamp: bigint[];
  deposit: bigint;
  mintedAt: bigint;
  serial: bigint;
  openAtas: number;
  traits: number[];
  bump: number;
};

export type OtcConfigExt = {
  stockMints: string[];
  counter: bigint[];
  acquired: bigint[];
  distributed: bigint[];
  addedAt: bigint[];
  bump: number;
};

export type OtcVaultExt = {
  stamp: bigint[];
  openAtas: number;
  slotCount: number;
  bump: number;
};

class Cursor {
  o = 0;
  constructor(readonly buf: Buffer) {}
  u8() {
    const v = this.buf[this.o]!;
    this.o += 1;
    return v;
  }
  u16() {
    const v = this.buf.readUInt16LE(this.o);
    this.o += 2;
    return v;
  }
  u32() {
    const v = this.buf.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u64() {
    const v = this.buf.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  i64() {
    const v = this.buf.readBigInt64LE(this.o);
    this.o += 8;
    return v;
  }
  u128() {
    const lo = this.buf.readBigUInt64LE(this.o);
    const hi = this.buf.readBigUInt64LE(this.o + 8);
    this.o += 16;
    return (hi << 64n) + lo;
  }
  pubkey() {
    const v = new PublicKey(this.buf.subarray(this.o, this.o + 32)).toBase58();
    this.o += 32;
    return v;
  }
  string() {
    const len = this.buf.readUInt32LE(this.o);
    this.o += 4;
    const v = this.buf.subarray(this.o, this.o + len).toString("utf8");
    this.o += len;
    return v;
  }
}

export function decodeConfig(data: Buffer): OtcConfig {
  if (data.length < 8 || !bufEqual(data.subarray(0, 8), CONFIG_DISCRIMINATOR)) {
    throw new Error("Not an OTC Config account");
  }
  const c = new Cursor(data);
  c.o = 8;
  const authority = c.pubkey();
  const protocolWallet = c.pubkey();
  const collection = c.pubkey();
  const namePrefix = c.string();
  const baseUri = c.string();
  const tokenMint = c.pubkey();
  const stockMints = Array.from({ length: TICKER_COUNT }, () => c.pubkey());
  const counter = Array.from({ length: TICKER_COUNT }, () => c.u128());
  const acquired = Array.from({ length: TICKER_COUNT }, () => c.u64());
  const distributed = Array.from({ length: TICKER_COUNT }, () => c.u64());
  return {
    authority,
    protocolWallet,
    collection,
    namePrefix,
    baseUri,
    tokenMint,
    stockMints,
    counter,
    acquired,
    distributed,
    holders: c.u64(),
    maxSupply: c.u64(),
    mintedCount: c.u64(),
    roundIndex: c.u8(),
    roundThreshold: c.u64(),
    lastRoundAt: c.i64(),
    pendingLamports: c.u64(),
    pendingPoolBefore: c.u64(),
    pendingIndex: c.u8(),
    minRoundInterval: c.i64(),
    depositRequired: c.u64(),
    surcharge: c.u64(),
    protocolShareBps: c.u16(),
    withdrawFeeLamports: c.u64(),
    withdrawFeeFloorLamports: c.u64(),
    withdrawFeeDecaySeconds: c.i64(),
    withdrawFeeStepSeconds: c.i64(),
    royaltyBps: c.u16(),
    solPotBump: c.u8(),
    bump: c.u8(),
  };
}

export function decodeVault(data: Buffer): OtcVault {
  if (data.length < 8 || !bufEqual(data.subarray(0, 8), VAULT_DISCRIMINATOR)) {
    throw new Error("Not an OTC Vault account");
  }
  const c = new Cursor(data);
  c.o = 8;
  const stamp = Array.from({ length: TICKER_COUNT }, () => c.u128());
  const deposit = c.u64();
  const mintedAt = c.i64();
  const serial = c.u64();
  const openAtas = c.u16();
  const traits = [c.u8(), c.u8(), c.u8(), c.u8()];
  const bump = c.u8();
  return { stamp, deposit, mintedAt, serial, openAtas, traits, bump };
}

export function decodeConfigExt(data: Buffer): OtcConfigExt {
  if (
    data.length < 8 ||
    !bufEqual(data.subarray(0, 8), CONFIG_EXT_DISCRIMINATOR)
  ) {
    throw new Error("Not an OTC ConfigExt account");
  }
  const c = new Cursor(data);
  c.o = 8;
  const stockMints = Array.from(
    { length: EXTENDED_TICKER_CAPACITY },
    () => c.pubkey(),
  );
  const counter = Array.from(
    { length: EXTENDED_TICKER_CAPACITY },
    () => c.u128(),
  );
  const acquired = Array.from(
    { length: EXTENDED_TICKER_CAPACITY },
    () => c.u64(),
  );
  const distributed = Array.from(
    { length: EXTENDED_TICKER_CAPACITY },
    () => c.u64(),
  );
  const addedAt = Array.from(
    { length: EXTENDED_TICKER_CAPACITY },
    () => c.i64(),
  );
  return {
    stockMints,
    counter,
    acquired,
    distributed,
    addedAt,
    bump: c.u8(),
  };
}

export function decodeVaultExt(data: Buffer): OtcVaultExt {
  if (
    data.length < 8 ||
    !bufEqual(data.subarray(0, 8), VAULT_EXT_DISCRIMINATOR)
  ) {
    throw new Error("Not an OTC VaultExt account");
  }
  const c = new Cursor(data);
  c.o = 8;
  const stamp = Array.from(
    { length: EXTENDED_TICKER_CAPACITY },
    () => c.u128(),
  );
  return {
    stamp,
    openAtas: c.u32(),
    slotCount: c.u8(),
    bump: c.u8(),
  };
}

/** Metaplex Core AssetV1: key u8, owner 32, update_authority enum, name, uri. */
export function decodeCoreAssetName(data: Buffer): {
  owner: string;
  name: string;
} {
  const owner = new PublicKey(data.subarray(1, 33)).toBase58();
  const c = new Cursor(data);
  c.o = 34;
  const uaKind = data[33]!;
  if (uaKind === 1 || uaKind === 2) c.o += 32;
  return { owner, name: c.string() };
}

function bufEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return a.compare(b) === 0;
}

const DEFAULT_PUBKEY = "11111111111111111111111111111111";

export function isDefaultMint(mint: string): boolean {
  return mint === DEFAULT_PUBKEY;
}

export function tickerOpen(openAtas: number, index: number): boolean {
  return ((openAtas >> index) & 1) === 1;
}

export function allTickersOpen(openAtas: number, setCount: number): boolean {
  if (setCount <= 0) return false;
  const mask = (1 << setCount) - 1;
  return (openAtas & mask) === mask;
}
