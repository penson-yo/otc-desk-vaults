"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  ArrowRightLeft,
  Check,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Frame } from "@/components/frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { QueueItem } from "@/lib/otc/claim-plan";
import { fmtNum, fmtUsd, shortAddress, solscanToken } from "@/lib/otc/format";
import {
  previewSwaps,
  SLIPPAGE_BPS,
  sumSwapOut,
  type SwapPreview,
} from "@/lib/otc/jupiter";
import { runSwapPreviews } from "@/lib/otc/run-swap";
import {
  defaultSelectedIds,
  destinationPresets,
  selectDeskTickerIds,
  selectedSwapTotals,
  selectedUsd,
  SOL_SWAP_RESERVE_LAMPORTS,
  type DestAsset,
  type WalletTokensResponse,
} from "@/lib/otc/wallet-tokens";
import { cn } from "@/lib/utils";

const SLIP = (SLIPPAGE_BPS / 100).toFixed(1);
const SOL_RESERVE = Number(SOL_SWAP_RESERVE_LAMPORTS) / 1e9;

export function BulkSwapPanel({ otcMint }: { otcMint?: string | null }) {
  const { connection } = useConnection();
  const {
    publicKey,
    connected,
    sendTransaction,
    signTransaction,
  } = useWallet();
  const { setVisible } = useWalletModal();

  const presets = useMemo(() => destinationPresets(otcMint), [otcMint]);
  const [dest, setDest] = useState<DestAsset>(presets[0]!);
  const [customMint, setCustomMint] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  const [usingCustom, setUsingCustom] = useState(false);

  const destMintRef = useRef(dest.mint);
  const [data, setData] = useState<WalletTokensResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<SwapPreview[] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const owner = publicKey?.toBase58() ?? null;
  const resolvedDest = useMemo(() => {
    const match = presets.find((p) => p.mint === dest.mint);
    if (match) return match;
    if (usingCustom) return dest;
    return presets[0]!;
  }, [presets, dest, usingCustom]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!owner) {
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ address: owner });
        if (otcMint) params.set("otcMint", otcMint);
        const timeout = AbortSignal.timeout(35_000);
        const combined =
          signal != null ? AbortSignal.any([signal, timeout]) : timeout;
        const res = await fetch(`/api/wallet-tokens?${params}`, {
          signal: combined,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        const next = json as WalletTokensResponse;
        setData(next);
        setSelected(new Set(defaultSelectedIds(next.tokens, destMintRef.current)));
        setPreview(null);
        setItems([]);
        setNote(null);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          if (!signal?.aborted) {
            setError("Timed out reading wallet token accounts. Retry in a moment.");
          }
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [owner, otcMint],
  );

  useEffect(() => {
    destMintRef.current = resolvedDest.mint;
  }, [resolvedDest.mint]);

  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch wallet tokens when the connected pubkey changes
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const tokens = useMemo(() => data?.tokens ?? [], [data]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.mint.toLowerCase().includes(q),
    );
  }, [tokens, filter]);

  const selectable = useMemo(
    () =>
      tokens.filter(
        (t) => t.mint !== resolvedDest.mint && BigInt(t.swapRaw) > 0n,
      ),
    [tokens, resolvedDest.mint],
  );

  const selectedTokens = useMemo(
    () => selectable.filter((t) => selected.has(t.id)),
    [selectable, selected],
  );

  const totals = useMemo(
    () => selectedSwapTotals(tokens, selected, resolvedDest.mint),
    [tokens, selected, resolvedDest.mint],
  );
  const usd = useMemo(
    () => selectedUsd(selectedTokens, new Set(selectedTokens.map((t) => t.id))),
    [selectedTokens],
  );

  useEffect(() => {
    if (running || totals.length === 0) return;
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      setQuoting(true);
      void previewSwaps({
        totals,
        outputMint: resolvedDest.mint,
        slippageBps: SLIPPAGE_BPS,
      })
        .then((next) => {
          if (!ac.signal.aborted) setPreview(next);
        })
        .catch(() => {
          if (!ac.signal.aborted) setPreview(null);
        })
        .finally(() => {
          if (!ac.signal.aborted) setQuoting(false);
        });
    }, 400);
    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [totals, resolvedDest.mint, running]);

  const shownPreview = useMemo(() => {
    if (totals.length === 0) return null;
    if (!preview) return null;
    if (
      preview.some(
        (p) => p.quote && p.quote.outputMint !== resolvedDest.mint,
      )
    ) {
      return null;
    }
    return preview;
  }, [preview, totals.length, resolvedDest.mint]);

  const previewById = useMemo(() => {
    const map = new Map<string, SwapPreview>();
    for (const p of shownPreview ?? []) map.set(p.id, p);
    return map;
  }, [shownPreview]);

  const estimatedOut = shownPreview
    ? sumSwapOut(shownPreview, resolvedDest.decimals)
    : 0;
  const quoteCount =
    shownPreview?.filter((p) => !p.skipped && p.quote).length ?? 0;
  const allVisibleSelected =
    visible.filter((t) => t.mint !== resolvedDest.mint && BigInt(t.swapRaw) > 0n)
      .length > 0 &&
    visible
      .filter((t) => t.mint !== resolvedDest.mint && BigInt(t.swapRaw) > 0n)
      .every((t) => selected.has(t.id));

  function toggle(id: string, mint: string) {
    if (mint === resolvedDest.mint || running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of visible) {
        if (t.mint === resolvedDest.mint || BigInt(t.swapRaw) <= 0n) continue;
        if (on) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });
  }

  function choosePreset(asset: DestAsset) {
    setUsingCustom(false);
    setCustomError(null);
    setDest(asset);
    if (data) {
      setSelected(new Set(defaultSelectedIds(data.tokens, asset.mint)));
    }
  }

  async function applyCustomMint() {
    const raw = customMint.trim();
    if (!raw) return;
    setCustomBusy(true);
    setCustomError(null);
    try {
      const mint = new PublicKey(raw).toBase58();
      const preset = presets.find((p) => p.mint === mint);
      if (preset) {
        choosePreset(preset);
        return;
      }
      const params = new URLSearchParams({ mint });
      if (otcMint) params.set("otcMint", otcMint);
      const res = await fetch(`/api/token-meta?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const asset = json as DestAsset;
      setUsingCustom(true);
      setDest(asset);
      if (data) {
        setSelected(new Set(defaultSelectedIds(data.tokens, asset.mint)));
      }
    } catch (err) {
      setCustomError(
        err instanceof Error ? err.message : "Not a valid mint address.",
      );
    } finally {
      setCustomBusy(false);
    }
  }

  async function runSwap() {
    if (!publicKey || totals.length === 0 || running) return;
    setRunning(true);
    setNote(
      `Wallet will ask you to sign ${totals.length} swap${totals.length === 1 ? "" : "s"}, one at a time · ${SLIP}% slip.`,
    );
    setItems([]);
    try {
      const live = await previewSwaps({
        totals,
        outputMint: resolvedDest.mint,
        slippageBps: SLIPPAGE_BPS,
      });
      setPreview(live);
      const est = sumSwapOut(live, resolvedDest.decimals);
      if (est > 0) {
        setNote(
          `Swapping into ~${fmtNum(est, { max: 4 })} ${resolvedDest.symbol} · ${SLIP}% slip. One signature per token.`,
        );
      }
      await runSwapPreviews({
        previews: live,
        outputSymbol: resolvedDest.symbol,
        userPublicKey: publicKey,
        connection,
        signTransaction: signTransaction
          ? (tx) => signTransaction(tx)
          : undefined,
        sendTransaction: (tx, conn) => sendTransaction(tx, conn),
        onProgress: setItems,
      });
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Frame
        title="Swap into"
        action={
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {SLIP}% slip
          </span>
        }
      >
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
          Select wallet tokens, pick the output asset (USDG by default), then
          swap them through Jupiter. Each token is its own transaction.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((asset) => {
            const active = !usingCustom && resolvedDest.mint === asset.mint;
            return (
              <button
                key={asset.mint}
                type="button"
                disabled={running}
                onClick={() => choosePreset(asset)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  active
                    ? "border-head/50 bg-head/10 text-head"
                    : "border-line bg-well text-muted-foreground hover:text-ink",
                )}
              >
                {asset.symbol}
              </button>
            );
          })}
          <button
            type="button"
            disabled={running}
            onClick={() => setUsingCustom(true)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              usingCustom
                ? "border-head/50 bg-head/10 text-head"
                : "border-line bg-well text-muted-foreground hover:text-ink",
            )}
          >
            Custom mint
          </button>
        </div>
        {usingCustom ? (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void applyCustomMint();
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="custom-mint" className="text-[11px] text-muted-foreground">
                Output mint
              </Label>
              <Input
                id="custom-mint"
                value={customMint}
                onChange={(e) => {
                  setCustomMint(e.target.value);
                  if (customError) setCustomError(null);
                }}
                placeholder="Solana mint address"
                className="border-line bg-well font-mono text-[12px]"
                autoComplete="off"
                spellCheck={false}
                disabled={running || customBusy}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={!customMint.trim() || customBusy || running}>
                {customBusy ? <Loader2 className="animate-spin" /> : <Check />}
                Use mint
              </Button>
            </div>
          </form>
        ) : null}
        {customError ? (
          <p className="mt-1.5 text-[11px] text-alert">{customError}</p>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Output{" "}
          <span className="font-medium text-ink">
            {resolvedDest.symbol}
          </span>
          {" · "}
          <a
            href={solscanToken(resolvedDest.mint)}
            target="_blank"
            rel="noreferrer"
            className="tnum hover:text-head"
          >
            {shortAddress(resolvedDest.mint, 6)}
          </a>
        </p>
      </Frame>

      <Frame
        title="Wallet tokens"
        live={!!connected}
        action={
          connected ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh wallet tokens"
            onClick={() => void load()}
            disabled={loading || running}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
          ) : null
        }
      >
        {!connected || !publicKey ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Connect the wallet that holds the tokens. This swaps balances
              already in the wallet — it does not claim desk vaults. Use Claim
              → USDG on the Vaults tab for that.
            </p>
            <Button
              type="button"
              className="mt-3"
              onClick={() => setVisible(true)}
            >
              <Wallet />
              Connect wallet
            </Button>
          </>
        ) : (
          <>
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
          Connected {shortAddress(publicKey.toBase58(), 6)}. Native SOL keeps{" "}
          {fmtNum(SOL_RESERVE, { max: 2 })} SOL for fees if you include it.
          Desk vault claims stay on the Vaults tab.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={running || selectable.length === 0}
            onClick={() => selectVisible(true)}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={running || selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={running || tokens.length === 0}
            onClick={() =>
              setSelected(
                new Set(selectDeskTickerIds(tokens, resolvedDest.mint, otcMint)),
              )
            }
          >
            Desk tickers
          </Button>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            className="h-7 w-[140px] border-line bg-well text-[12px]"
            disabled={running}
          />
        </div>

        {error ? (
          <Alert variant="destructive" className="mt-3">
            <AlertTitle>Could not load wallet tokens</AlertTitle>
            <AlertDescription className="text-[12px]">{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading && !data ? (
          <div className="mt-3 grid gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 bg-well" />
            ))}
          </div>
        ) : null}

        {data ? (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <Table>
              <TableHeader>
                <TableRow className="border-line hover:bg-transparent">
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--head)]"
                      checked={allVisibleSelected}
                      disabled={running}
                      onChange={(e) => selectVisible(e.target.checked)}
                      aria-label="Select visible tokens"
                    />
                  </TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead className="text-right">Est. {resolvedDest.symbol}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      {tokens.length === 0
                        ? "No fungible tokens in this wallet."
                        : "No tokens match that filter."}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((t) => {
                    const disabled =
                      t.mint === resolvedDest.mint || BigInt(t.swapRaw) <= 0n;
                    const quote = previewById.get(t.id);
                    const out =
                      quote?.outAmount != null
                        ? Number(quote.outAmount) / 10 ** resolvedDest.decimals
                        : null;
                    return (
                      <TableRow
                        key={t.id}
                        className={cn(
                          "border-line",
                          selected.has(t.id) && !disabled && "bg-well/50",
                        )}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            className="size-3.5 accent-[var(--head)]"
                            checked={selected.has(t.id) && !disabled}
                            disabled={disabled || running}
                            onChange={() => toggle(t.id, t.mint)}
                            aria-label={`Select ${t.symbol}`}
                          />
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            className="text-left"
                            disabled={disabled || running}
                            onClick={() => toggle(t.id, t.mint)}
                          >
                            <div className="font-medium text-ink">{t.symbol}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {t.isNative
                                ? `Keeps ${fmtNum(SOL_RESERVE, { max: 2 })} SOL for fees`
                                : t.name}
                              {t.mint === resolvedDest.mint ? " · output asset" : ""}
                            </div>
                          </button>
                        </TableCell>
                        <TableCell className="tnum text-right">
                          {fmtNum(t.amount, { max: t.decimals > 6 ? 6 : 4 })}
                        </TableCell>
                        <TableCell className="tnum text-right">
                          {fmtUsd(t.usd)}
                        </TableCell>
                        <TableCell className="tnum text-right text-muted-foreground">
                          {disabled
                            ? "—"
                            : quote?.skipped
                              ? quote.reason
                              : out != null
                                ? fmtNum(out, { max: 4 })
                                : quoting && selected.has(t.id)
                                  ? "…"
                                  : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">
            {selectedTokens.length} selected
            {usd != null ? ` · ${fmtUsd(usd)}` : ""}
            {quoting ? " · quoting Jupiter…" : ""}
            {estimatedOut > 0
              ? ` · ~${fmtNum(estimatedOut, { max: 4 })} ${resolvedDest.symbol}`
              : ""}
          </p>
          <Button
            type="button"
            disabled={
              running || quoting || quoteCount === 0 || selectedTokens.length === 0
            }
            onClick={() => void runSwap()}
            title={
              quoteCount === 0
                ? "No Jupiter routes for the selected tokens."
                : `Swap ${quoteCount} token${quoteCount === 1 ? "" : "s"} into ${resolvedDest.symbol}`
            }
          >
            {running ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
            Swap {quoteCount || selectedTokens.length} → {resolvedDest.symbol}
          </Button>
        </div>
          </>
        )}
      </Frame>

      {items.length > 0 || note ? (
        <Frame title="Swap queue">
          {note ? (
            <p className="text-[12px] text-muted-foreground">{note}</p>
          ) : null}
          {items.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {items.map((it) => (
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
        </Frame>
      ) : null}
    </>
  );
}
