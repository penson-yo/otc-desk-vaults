import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { explainTxError, type QueueItem } from "./claim-plan";
import {
  buildSwapTransaction,
  type JupiterQuote,
  type SwapPreview,
} from "./jupiter";
import { broadcastAndConfirmRawTransaction } from "./run-claim";

export async function executeSwapQuote(args: {
  quote: JupiterQuote;
  userPublicKey: string;
  connection: Connection;
  signTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  sendTransaction: (
    tx: VersionedTransaction,
    connection: Connection,
  ) => Promise<string>;
}): Promise<string> {
  const vtx = await buildSwapTransaction({
    quote: args.quote,
    userPublicKey: args.userPublicKey,
  });
  if (args.signTransaction) {
    const signed = await args.signTransaction(vtx);
    return broadcastAndConfirmRawTransaction({
      connection: args.connection,
      rawTransaction: signed.serialize(),
      blockhash: signed.message.recentBlockhash,
    });
  }
  const sig = await args.sendTransaction(vtx, args.connection);
  await args.connection.confirmTransaction(sig, "confirmed");
  return sig;
}

export function swapQueueId(preview: Pick<SwapPreview, "id" | "mint">): string {
  return `swap:${preview.id || preview.mint}`;
}

export async function runSwapPreviews(args: {
  previews: SwapPreview[];
  outputSymbol: string;
  userPublicKey: PublicKey;
  connection: Connection;
  signTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  sendTransaction: (
    tx: VersionedTransaction,
    connection: Connection,
  ) => Promise<string>;
  onProgress: (items: QueueItem[]) => void;
}): Promise<QueueItem[]> {
  let items: QueueItem[] = args.previews.map((preview) => ({
    id: swapQueueId(preview),
    label: `${preview.symbol} → ${args.outputSymbol}`,
    status: preview.skipped || !preview.quote ? "skipped" : "pending",
    error: preview.skipped ? preview.reason : undefined,
  }));
  args.onProgress(items);

  for (const preview of args.previews) {
    const id = swapQueueId(preview);
    const patch = (
      status: QueueItem["status"],
      extra?: Partial<QueueItem>,
    ) => {
      items = items.map((item) =>
        item.id === id ? { ...item, status, ...extra } : item,
      );
      args.onProgress(items);
    };
    if (preview.skipped || !preview.quote) continue;
    try {
      patch("signed");
      const signature = await executeSwapQuote({
        quote: preview.quote,
        userPublicKey: args.userPublicKey.toBase58(),
        connection: args.connection,
        signTransaction: args.signTransaction,
        sendTransaction: args.sendTransaction,
      });
      patch("sent", { signature });
    } catch (err) {
      const error = explainTxError(err);
      patch("failed", { error });
      if (/cancelled/i.test(error)) break;
    }
  }
  return items;
}
