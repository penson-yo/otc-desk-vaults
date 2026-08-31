import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import { PROGRAM_ID, TICKER_COUNT } from "./constants";
import {
  configExtPda,
  poolStockAta,
  userStockAta,
  vaultExtPda,
  vaultStockAta,
} from "./pda";

/** `claim` — drain one vault ticker into the holder wallet; leave ATA open. */
export const CLAIM_DISCRIMINATOR = Uint8Array.from([
  62, 198, 214, 193, 213, 159, 108, 210,
]);

/** `distribute` — permissionless owed → vault ATA (ATA must already exist). */
export const DISTRIBUTE_DISCRIMINATOR = Uint8Array.from([
  191, 44, 223, 207, 164, 236, 126, 61,
]);

/** `sweep` — holder-paid distribute; can create the vault ATA. */
export const SWEEP_DISCRIMINATOR = Uint8Array.from([
  40, 23, 234, 175, 14, 61, 154, 177,
]);

function indexData(disc: Uint8Array, index: number): Uint8Array {
  if (index < 0 || index > 255) {
    throw new Error(`Ticker index out of range: ${index}`);
  }
  const data = new Uint8Array(9);
  data.set(disc, 0);
  data[8] = index;
  return data;
}

function meta(
  pubkey: PublicKey,
  isWritable: boolean,
  isSigner = false,
): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

/** Anchor optional accounts use the program ID as the `None` sentinel. */
function extensionAccount(index: number, account: PublicKey): PublicKey {
  return index < TICKER_COUNT ? PROGRAM_ID : account;
}

export type ClaimAccounts = {
  user: PublicKey;
  config: PublicKey;
  asset: PublicKey;
  vault: PublicKey;
  stockMint: PublicKey;
  index: number;
};

export function claimInstruction(args: ClaimAccounts): TransactionInstruction {
  const nftStock = vaultStockAta(args.vault, args.stockMint);
  const userStock = userStockAta(args.user, args.stockMint);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(indexData(CLAIM_DISCRIMINATOR, args.index)),
    keys: [
      meta(args.user, true, true),
      meta(args.config, false),
      meta(extensionAccount(args.index, configExtPda()), false),
      meta(args.asset, false),
      meta(args.vault, true),
      meta(extensionAccount(args.index, vaultExtPda(args.vault)), true),
      meta(args.stockMint, false),
      meta(nftStock, true),
      meta(userStock, true),
      meta(TOKEN_2022_PROGRAM_ID, false),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID, false),
      meta(SystemProgram.programId, false),
    ],
  });
}

export type DistributeAccounts = {
  config: PublicKey;
  vault: PublicKey;
  stockMint: PublicKey;
  index: number;
};

export function distributeInstruction(
  args: DistributeAccounts,
): TransactionInstruction {
  const pool = poolStockAta(args.config, args.stockMint);
  const nftStock = vaultStockAta(args.vault, args.stockMint);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(indexData(DISTRIBUTE_DISCRIMINATOR, args.index)),
    keys: [
      meta(args.config, true),
      meta(
        extensionAccount(args.index, configExtPda()),
        args.index >= TICKER_COUNT,
      ),
      meta(args.vault, true),
      meta(extensionAccount(args.index, vaultExtPda(args.vault)), true),
      meta(args.stockMint, false),
      meta(pool, true),
      meta(nftStock, true),
      meta(TOKEN_2022_PROGRAM_ID, false),
    ],
  });
}

export type SweepAccounts = {
  payer: PublicKey;
  config: PublicKey;
  vault: PublicKey;
  stockMint: PublicKey;
  index: number;
};

export function sweepInstruction(args: SweepAccounts): TransactionInstruction {
  const pool = poolStockAta(args.config, args.stockMint);
  const nftStock = vaultStockAta(args.vault, args.stockMint);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(indexData(SWEEP_DISCRIMINATOR, args.index)),
    keys: [
      meta(args.payer, true, true),
      meta(args.config, true),
      meta(
        extensionAccount(args.index, configExtPda()),
        args.index >= TICKER_COUNT,
      ),
      meta(args.vault, true),
      meta(extensionAccount(args.index, vaultExtPda(args.vault)), true),
      meta(args.stockMint, false),
      meta(pool, true),
      meta(nftStock, true),
      meta(TOKEN_2022_PROGRAM_ID, false),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID, false),
      meta(SystemProgram.programId, false),
    ],
  });
}

export type PackedTxIxs = TransactionInstruction[];

export type IxGroup<T = unknown> = {
  ixs: TransactionInstruction[];
  extra: T;
};

/**
 * Pack instruction groups into legacy txs. Groups stay atomic (sweep+claim
 * for one ticker never split). `headroom` leaves room for signatures / CU ixs.
 */
export function packInstructionGroups(
  groups: TransactionInstruction[][],
  feePayer: PublicKey,
  recentBlockhash: string,
  headroom = 192,
  maxIxs = 8,
): PackedTxIxs[] {
  return packTaggedGroups(
    groups.map((ixs) => ({ ixs, extra: null })),
    feePayer,
    recentBlockhash,
    headroom,
    maxIxs,
  ).map((b) => b.ixs);
}

export function packTaggedGroups<T>(
  groups: IxGroup<T>[],
  feePayer: PublicKey,
  recentBlockhash: string,
  headroom = 192,
  maxIxs = 8,
): { ixs: TransactionInstruction[]; extras: T[] }[] {
  const limit = 1232 - headroom;
  const sizeOf = (ixs: TransactionInstruction[]) => {
    if (ixs.length === 0) return 0;
    const tx = new Transaction().add(...ixs);
    tx.feePayer = feePayer;
    tx.recentBlockhash = recentBlockhash;
    return tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length;
  };

  const txs: { ixs: TransactionInstruction[]; extras: T[] }[] = [];
  let currentIxs: TransactionInstruction[] = [];
  let currentExtras: T[] = [];
  for (const group of groups) {
    if (group.ixs.length === 0) continue;
    if (currentIxs.length === 0) {
      currentIxs = [...group.ixs];
      currentExtras = [group.extra];
      continue;
    }
    const next = [...currentIxs, ...group.ixs];
    if (next.length <= maxIxs && sizeOf(next) <= limit) {
      currentIxs = next;
      currentExtras.push(group.extra);
    } else {
      txs.push({ ixs: currentIxs, extras: currentExtras });
      currentIxs = [...group.ixs];
      currentExtras = [group.extra];
    }
  }
  if (currentIxs.length > 0) txs.push({ ixs: currentIxs, extras: currentExtras });
  return txs;
}
