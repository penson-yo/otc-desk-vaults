import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getTransferHook, TOKEN_2022_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import {
  explainTxError,
  groupInstructions,
  itemIdsForGroup,
  type ClaimGroup,
  type QueueItem,
} from "./claim-plan";
import { packTaggedGroups } from "./instructions";
import { configPda } from "./pda";

export type PackedBatch = {
  ixs: TransactionInstruction[];
  itemIds: string[];
};

export type SendFns = {
  sendTransaction: (
    tx: Transaction,
    connection: Connection,
  ) => Promise<string>;
  signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]>;
};

type SubmittedTransaction = {
  signature: string;
  itemIds: string[];
};

const CU_PER_IX = 250_000;
const MAX_CU = 1_400_000;
const CU_PRICE = 10_000;
const SIGN_ALL_CHUNK = 5;
const CONFIRM_POLL_MS = 750;

export function hasActiveTransferHook(
  hook: ReturnType<typeof getTransferHook>,
): boolean {
  return hook !== null && !hook.programId.equals(PublicKey.default);
}

export async function mintsWithTransferHook(
  connection: Connection,
  mints: string[],
): Promise<Set<string>> {
  const unique = [...new Set(mints)];
  const keys = unique.map((m) => new PublicKey(m));
  const hooked = new Set<string>();
  for (let i = 0; i < keys.length; i += 100) {
    const slice = keys.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(slice);
    slice.forEach((key, j) => {
      const info = infos[j];
      if (!info) return;
      try {
        const mint = unpackMint(key, info, TOKEN_2022_PROGRAM_ID);
        if (hasActiveTransferHook(getTransferHook(mint))) {
          hooked.add(key.toBase58());
        }
      } catch {
        // If we cannot parse extensions, try the instruction and surface errors.
      }
    });
  }
  return hooked;
}

export function applyHookSkips(
  groups: ClaimGroup[],
  items: QueueItem[],
  hooked: Set<string>,
): { groups: ClaimGroup[]; items: QueueItem[] } {
  if (hooked.size === 0) return { groups, items };
  const nextItems = items.map((it) => {
    const mint = it.id.split(":")[1];
    if (mint && hooked.has(mint)) {
      return {
        ...it,
        status: "skipped" as const,
        error: "Transfer hook requires extra accounts; skipped.",
      };
    }
    return it;
  });
  return {
    groups: groups.filter((g) => !hooked.has(g.mint)),
    items: nextItems,
  };
}

export function packClaimBatches(
  groups: ClaimGroup[],
  user: PublicKey,
  recentBlockhash: string,
  config: PublicKey = configPda(),
): PackedBatch[] {
  const packed = packTaggedGroups(
    groups.map((g) => ({
      ixs: groupInstructions(g, user, config),
      extra: itemIdsForGroup(g),
    })),
    user,
    recentBlockhash,
  );
  return packed.map((b) => ({
    ixs: b.ixs,
    itemIds: b.extras.flat(),
  }));
}

export function withComputeBudget(
  ixs: TransactionInstruction[],
): TransactionInstruction[] {
  const units = Math.min(MAX_CU, Math.max(200_000, CU_PER_IX * ixs.length));
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE }),
    ...ixs,
  ];
}

async function confirmSubmittedTransactions(args: {
  connection: Connection;
  submitted: SubmittedTransaction[];
  lastValidBlockHeight: number;
  onConfirmed: (tx: SubmittedTransaction) => void;
  onFailed: (tx: SubmittedTransaction, error: unknown) => void;
  pollIntervalMs?: number;
}): Promise<void> {
  let pending = [...args.submitted];
  const pollIntervalMs = args.pollIntervalMs ?? CONFIRM_POLL_MS;

  while (pending.length > 0) {
    try {
      const statuses = await args.connection.getSignatureStatuses(
        pending.map((tx) => tx.signature),
        { searchTransactionHistory: true },
      );
      const next: SubmittedTransaction[] = [];
      statuses.value.forEach((status, index) => {
        const tx = pending[index]!;
        if (status?.err) {
          args.onFailed(
            tx,
            new Error(`Transaction failed: ${JSON.stringify(status.err)}`),
          );
        } else if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        ) {
          args.onConfirmed(tx);
        } else {
          next.push(tx);
        }
      });
      pending = next;
    } catch {
      // A transient status-read failure should not relabel submitted claims.
    }

    if (pending.length === 0) return;

    let blockHeight: number;
    try {
      blockHeight = await args.connection.getBlockHeight("confirmed");
    } catch (err) {
      pending.forEach((tx) => args.onFailed(tx, err));
      return;
    }
    if (blockHeight > args.lastValidBlockHeight) {
      pending.forEach((tx) =>
        args.onFailed(
          tx,
          new Error(
            `Signature ${tx.signature} has expired: block height exceeded.`,
          ),
        ),
      );
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function sendClaimBatches(args: {
  connection: Connection;
  user: PublicKey;
  batches: PackedBatch[];
  items: QueueItem[];
  send: SendFns;
  onProgress: (items: QueueItem[]) => void;
}): Promise<QueueItem[]> {
  const items = args.items.map((it) => ({ ...it }));
  const patch = (ids: string[], status: QueueItem["status"], extra?: Partial<QueueItem>) => {
    for (const it of items) {
      if (!ids.includes(it.id) || it.status === "skipped") continue;
      Object.assign(it, { status, ...extra });
    }
    args.onProgress(items.map((it) => ({ ...it })));
  };

  const canSignAll = typeof args.send.signAllTransactions === "function";

  const buildTx = (ixs: TransactionInstruction[], blockhash: string) => {
    const tx = new Transaction().add(...withComputeBudget(ixs));
    tx.feePayer = args.user;
    tx.recentBlockhash = blockhash;
    return tx;
  };

  if (canSignAll && args.batches.length > 0) {
    for (let i = 0; i < args.batches.length; i += SIGN_ALL_CHUNK) {
      const chunk = args.batches.slice(i, i + SIGN_ALL_CHUNK);
      const idSlice = chunk.flatMap((b) => b.itemIds);
      let signed: Transaction[];
      let lastValidBlockHeight: number;
      try {
        const latest =
          await args.connection.getLatestBlockhash("confirmed");
        lastValidBlockHeight = latest.lastValidBlockHeight;
        const slice = chunk.map((b) => buildTx(b.ixs, latest.blockhash));
        signed = await args.send.signAllTransactions!(slice);
      } catch (err) {
        patch(idSlice, "failed", { error: explainTxError(err) });
        if (/cancelled/i.test(explainTxError(err))) break;
        continue;
      }

      patch(idSlice, "signed");
      const submitted: SubmittedTransaction[] = [];
      for (let j = 0; j < signed.length; j++) {
        const ids = chunk[j]!.itemIds;
        try {
          const signature = await args.connection.sendRawTransaction(
            signed[j]!.serialize(),
            { skipPreflight: false, preflightCommitment: "confirmed" },
          );
          submitted.push({ signature, itemIds: ids });
        } catch (err) {
          patch(ids, "failed", { error: explainTxError(err) });
        }
      }

      await confirmSubmittedTransactions({
        connection: args.connection,
        submitted,
        lastValidBlockHeight,
        onConfirmed: ({ signature, itemIds }) =>
          patch(itemIds, "sent", { signature }),
        onFailed: ({ itemIds }, err) =>
          patch(itemIds, "failed", { error: explainTxError(err) }),
      });
    }
    return items;
  }

  for (const batch of args.batches) {
    const ids = batch.itemIds;
    try {
      const { blockhash, lastValidBlockHeight } =
        await args.connection.getLatestBlockhash("confirmed");
      const tx = buildTx(batch.ixs, blockhash);
      patch(ids, "signed");
      const signature = await args.send.sendTransaction(tx, args.connection);
      await confirmSubmittedTransactions({
        connection: args.connection,
        submitted: [{ signature, itemIds: ids }],
        lastValidBlockHeight,
        onConfirmed: (submitted) =>
          patch(ids, "sent", { signature: submitted.signature }),
        onFailed: (_submitted, err) =>
          patch(ids, "failed", { error: explainTxError(err) }),
      });
    } catch (err) {
      patch(ids, "failed", { error: explainTxError(err) });
      if (/cancelled/i.test(explainTxError(err))) break;
    }
  }
  return items;
}
