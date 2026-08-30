"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { ArrowRightLeft, Download, Loader2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  explainTxError,
  groupsToQueueItems,
  mintTotals,
  ownedDesks,
  planClaim,
  type QueueItem,
} from "@/lib/otc/claim-plan";
import { fmtNum } from "@/lib/otc/format";
import {
  buildSwapTransaction,
  previewSwaps,
  SLIPPAGE_BPS,
  sumOtcOut,
  type SwapPreview,
} from "@/lib/otc/jupiter";
import { userStockAta } from "@/lib/otc/pda";
import {
  applyHookSkips,
  mintsWithTransferHook,
  packClaimBatches,
  sendClaimBatches,
} from "@/lib/otc/run-claim";
import type { PortfolioResponse } from "@/lib/otc/types";
import { cn } from "@/lib/utils";

type ClaimContextValue = {
  enabled: boolean;
  running: boolean;
  items: QueueItem[];
  preview: SwapPreview[] | null;
  note: string | null;
  disabledReason: string | null;
  claimAll: () => void;
  claimToOtc: () => void;
};

const ClaimContext = createContext<ClaimContextValue | null>(null);

export function ClaimProvider({
  data,
  connectedInView,
  loading,
  onRefresh,
  children,
}: {
  data: PortfolioResponse | null;
  connectedInView: boolean;
  loading: boolean;
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction, signAllTransactions } =
    useWallet();
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [preview, setPreview] = useState<SwapPreview[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const owner = publicKey?.toBase58() ?? null;
  const mine = useMemo(
    () => (data && owner ? ownedDesks(data.desks, owner) : []),
    [data, owner],
  );
  const plan = useMemo(
    () => (data && owner ? planClaim(data.desks, owner) : []),
    [data, owner],
  );
  const claimable = plan.length > 0;
  const enabled =
    connected &&
    !!publicKey &&
    connectedInView &&
    mine.length > 0 &&
    claimable &&
    !running &&
    !loading;

  const disabledReason = !connected
    ? "Connect a wallet that owns desks."
    : !connectedInView
      ? "Add this wallet to the list to load its desks."
      : mine.length === 0
        ? "This wallet does not own a desk in the loaded portfolio."
        : !claimable
          ? "Nothing to claim on these desks."
          : running
            ? "A claim queue is running."
            : loading
              ? "Still reading the chain."
              : null;

  const run = useCallback(
    async (toOtc: boolean) => {
      if (!publicKey || !data) return;
      const ownerKey = publicKey.toBase58();
      let groups = planClaim(data.desks, ownerKey);
      if (groups.length === 0) return;
      if (!connectedInView || mine.length === 0) return;

      setRunning(true);
      setNote(null);
      let queue = groupsToQueueItems(groups);
      setItems(queue);
      setPreview(null);

      try {
        const hooked = await mintsWithTransferHook(
          connection,
          groups.map((g) => g.mint),
        );
        const skipped = applyHookSkips(groups, queue, hooked);
        groups = skipped.groups;
        queue = skipped.items;
        setItems(queue);
        if (groups.length === 0) {
          setNote("Every ticker was skipped (transfer hook or empty).");
          return;
        }

        const slip = (SLIPPAGE_BPS / 100).toFixed(1);
        if (toOtc) {
          const totals = mintTotals(groups);
          const estQuotes = await previewSwaps({
            totals,
            otcMint: data.protocol.tokenMint,
            slippageBps: SLIPPAGE_BPS,
          });
          setPreview(estQuotes);
          const est = sumOtcOut(estQuotes);
          setNote(
            est > 0
              ? `Est. ${fmtNum(est, { max: 2 })} OTC · ${slip}% slip. Wallet will ask you to sign.`
              : `Quotes failed or dust — claims still run. ${slip}% slip on swaps.`,
          );
        } else {
          setNote("Wallet will ask you to sign. Several approvals are OK.");
        }

        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const batches = packClaimBatches(groups, publicKey, blockhash);
        queue = await sendClaimBatches({
          connection,
          user: publicKey,
          batches,
          items: queue,
          send: {
            sendTransaction: (tx, conn) => sendTransaction(tx, conn),
            signAllTransactions: signAllTransactions
              ? (txs) => signAllTransactions(txs)
              : undefined,
          },
          onProgress: setItems,
        });

        const claimFailed = queue.some((it) => it.status === "failed");
        const claimSent = queue.some((it) => it.status === "sent");

        if (toOtc && claimSent) {
          const otcMint = data.protocol.tokenMint;
          const uniqueMints = [...new Set(groups.map((g) => g.mint))];
          const swapItems: QueueItem[] = [];
          const swapTotals: { mint: string; symbol: string; raw: bigint }[] =
            [];
          for (const mint of uniqueMints) {
            const symbol =
              groups.find((g) => g.mint === mint)?.symbol ?? mint.slice(0, 4);
            const ata = userStockAta(publicKey, new PublicKey(mint));
            let raw = 0n;
            try {
              const bal = await connection.getTokenAccountBalance(ata);
              raw = BigInt(bal.value.amount);
            } catch {
              raw = 0n;
            }
            const id = `swap:${mint}`;
            if (raw <= 0n) {
              swapItems.push({
                id,
                label: `${symbol} → $OTC`,
                status: "skipped",
                error: "No wallet balance after claim",
              });
              continue;
            }
            swapTotals.push({ mint, symbol, raw });
            swapItems.push({
              id,
              label: `${symbol} → $OTC`,
              status: "pending",
            });
          }
          queue = [...queue, ...swapItems];
          setItems(queue);

          const livePreviews = await previewSwaps({
            totals: swapTotals,
            otcMint,
            slippageBps: SLIPPAGE_BPS,
          });
          setPreview(livePreviews);
          const est = sumOtcOut(livePreviews);
          if (est > 0) {
            setNote(
              `Swapping into ~${fmtNum(est, { max: 2 })} OTC · ${slip}% slip.`,
            );
          }

          for (const p of livePreviews) {
            const id = `swap:${p.mint}`;
            const patchSwap = (
              status: QueueItem["status"],
              extra?: Partial<QueueItem>,
            ) => {
              queue = queue.map((it) =>
                it.id === id ? { ...it, status, ...extra } : it,
              );
              setItems(queue);
            };
            if (p.skipped || !p.quote) {
              patchSwap("skipped", { error: p.reason ?? "No quote" });
              continue;
            }
            try {
              const vtx = await buildSwapTransaction({
                quote: p.quote,
                userPublicKey: publicKey.toBase58(),
              });
              patchSwap("signed");
              const sig = await sendTransaction(vtx, connection);
              const latest = await connection.getLatestBlockhash("confirmed");
              await connection.confirmTransaction(
                {
                  signature: sig,
                  blockhash: latest.blockhash,
                  lastValidBlockHeight: latest.lastValidBlockHeight,
                },
                "confirmed",
              );
              patchSwap("sent", { signature: sig });
            } catch (err) {
              patchSwap("failed", { error: explainTxError(err) });
            }
          }
        }

        if (
          claimSent ||
          queue.some((it) => it.id.startsWith("swap:") && it.status === "sent")
        ) {
          await onRefresh();
        }
        if (claimFailed && !claimSent) {
          setNote((n) => n ?? "Claim did not land. Nothing was swapped.");
        }
      } catch (err) {
        setNote(explainTxError(err));
      } finally {
        setRunning(false);
      }
    },
    [
      publicKey,
      data,
      connectedInView,
      mine.length,
      connection,
      sendTransaction,
      signAllTransactions,
      onRefresh,
    ],
  );

  const value: ClaimContextValue = {
    enabled,
    running,
    items,
    preview,
    note,
    disabledReason,
    claimAll: () => void run(false),
    claimToOtc: () => void run(true),
  };

  return <ClaimContext.Provider value={value}>{children}</ClaimContext.Provider>;
}

function useClaim() {
  const ctx = useContext(ClaimContext);
  if (!ctx) throw new Error("ClaimButtons must be used inside ClaimProvider");
  return ctx;
}

export function ClaimButtons({
  size = "default",
}: {
  size?: "default" | "sm";
}) {
  const { connected } = useWallet();
  const ctx = useClaim();
  if (!connected) return null;
  const busy = ctx.running;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={!ctx.enabled}
        title={
          ctx.disabledReason ??
          "Sweep owed, then claim vault stock. Desk stays live."
        }
        onClick={ctx.claimAll}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Download />}
        Claim all
      </Button>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={!ctx.enabled}
        title={
          ctx.disabledReason ??
          `Claim, then swap tickers into $OTC via Jupiter · ${(SLIPPAGE_BPS / 100).toFixed(1)}% slip.`
        }
        onClick={ctx.claimToOtc}
      >
        {busy ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
        Claim → OTC
      </Button>
    </div>
  );
}

export function ClaimProgress() {
  const ctx = useClaim();
  if (ctx.items.length === 0 && !ctx.note) return null;
  const est = ctx.preview ? sumOtcOut(ctx.preview) : 0;
  return (
    <div className="mt-3 rounded-lg border border-line bg-well/40 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink">
          Claim queue
        </p>
        {est > 0 ? (
          <p className="tnum text-[11px] text-muted-foreground">
            Est. {fmtNum(est, { max: 2 })} OTC ·{" "}
            {(SLIPPAGE_BPS / 100).toFixed(1)}% slip
          </p>
        ) : null}
      </div>
      {ctx.note ? (
        <p className="mt-1 text-[12px] text-muted-foreground">{ctx.note}</p>
      ) : null}
      {ctx.items.length > 0 ? (
        <ul className="mt-2 grid gap-1">
          {ctx.items.map((it) => (
            <li
              key={it.id}
              className="flex items-baseline justify-between gap-2 text-[11.5px]"
            >
              <span className="min-w-0 truncate text-ink">{it.label}</span>
              <span
                className={cn(
                  "tnum shrink-0 text-right",
                  it.status === "sent" && "text-phos",
                  it.status === "signed" && "text-gold",
                  it.status === "failed" && "text-alert",
                  (it.status === "skipped" || it.status === "pending") &&
                    "text-muted-foreground",
                )}
                title={it.error}
              >
                {it.status}
                {it.error ? ` · ${it.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
