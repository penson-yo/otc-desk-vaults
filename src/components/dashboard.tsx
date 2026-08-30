"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  ChevronDown,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Frame } from "@/components/frame";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WATCH_STORAGE_KEY } from "@/lib/otc/constants";
import {
  fmtNum,
  fmtOtc,
  fmtPct,
  fmtTime,
  fmtUsd,
  magicEdenItem,
  shortAddress,
  solscanAccount,
} from "@/lib/otc/format";
import type { DeskHolding, PortfolioResponse, WatchWallet } from "@/lib/otc/types";
import { cn } from "@/lib/utils";

function readStored(): WatchWallet[] | null {
  try {
    const raw = localStorage.getItem(WATCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WatchWallet[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.filter((w) => w?.address);
  } catch {
    return null;
  }
}

function persist(wallets: WatchWallet[]) {
  try {
    if (wallets.length === 0) {
      localStorage.removeItem(WATCH_STORAGE_KEY);
      return;
    }
    localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(wallets));
  } catch {
    // ignore
  }
}

function fromUrl(): WatchWallet[] | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const addresses = params.getAll("address");
  const csv = params.get("addresses");
  const extra = csv ? csv.split(/[,\s]+/).filter(Boolean) : [];
  const all = [...addresses, ...extra];
  const labels = params.getAll("label");
  if (all.length === 0) return null;
  const out: WatchWallet[] = [];
  const seen = new Set<string>();
  all.forEach((a, i) => {
    try {
      const pk = new PublicKey(a).toBase58();
      if (seen.has(pk)) return;
      seen.add(pk);
      out.push({ address: pk, label: labels[i] || `Wallet ${out.length + 1}` });
    } catch {
      // skip
    }
  });
  return out.length ? out : null;
}

function writeUrl(wallets: WatchWallet[]) {
  const params = new URLSearchParams();
  for (const w of wallets) {
    params.append("address", w.address);
    if (w.label) params.append("label", w.label);
  }
  const qs = params.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", next);
}

function sameWatchList(a: WatchWallet[], b: readonly WatchWallet[]) {
  if (a.length !== b.length) return false;
  return a.every((w, i) => w.address === b[i]?.address);
}

export function Dashboard({
  initialData,
  initialError,
}: {
  initialData: PortfolioResponse | null;
  initialError: string | null;
}) {
  const [wallets, setWallets] = useState<WatchWallet[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [data, setData] = useState<PortfolioResponse | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  const paintedKey = useRef(
    initialData ? initialData.wallets.map((w) => w.address).join(",") : null,
  );
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  useEffect(() => {
    const fromQuery = fromUrl();
    const stored = readStored();
    const initial = fromQuery ?? stored ?? [];
    // Hydrate from URL / localStorage after mount (SSR has no window).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage/URL hydration
    setWallets(initial);
    persist(initial);
    if (!fromQuery) writeUrl(initial);
    setHydrated(true);
  }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    wallets.forEach((w) => {
      p.append("address", w.address);
      p.append("label", w.label);
    });
    return p.toString();
  }, [wallets]);

  const load = useCallback(
    async (signal?: AbortSignal, opts?: { silent?: boolean }) => {
      if (wallets.length === 0) {
        setData(null);
        setError(null);
        setLoading(false);
        paintedKey.current = null;
        return;
      }
      if (!opts?.silent) {
        setLoading(true);
        setError(null);
        setData((prev) =>
          prev && sameWatchList(wallets, prev.wallets) ? prev : null,
        );
      }
      const timeout = AbortSignal.timeout(35_000);
      const combined =
        signal != null ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const res = await fetch(`/api/portfolio?${query}`, { signal: combined });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        const next = json as PortfolioResponse;
        setData(next);
        setError(null);
        paintedKey.current = next.wallets.map((w) => w.address).join(",");
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          if (signal?.aborted) return;
          if (!opts?.silent) {
            setError(
              "Timed out reading the chain. Public RPC is often busy — retry in a moment.",
            );
          }
          return;
        }
        if (!opts?.silent) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [query, wallets],
  );

  useEffect(() => {
    if (!hydrated) return;
    const ac = new AbortController();
    const key = wallets.map((w) => w.address).join(",");
    const silent = paintedKey.current === key;
    void load(ac.signal, { silent });
    return () => ac.abort();
  }, [hydrated, load, wallets]);

  useEffect(() => {
    if (!hydrated || wallets.length === 0) return;
    const id = window.setInterval(() => {
      void load(undefined, { silent: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [hydrated, wallets.length, load]);

  function update(next: WatchWallet[]) {
    setWallets(next);
    persist(next);
    writeUrl(next);
  }

  function addWallet() {
    const raw = addressInput.trim();
    if (!raw) return;
    try {
      const pk = new PublicKey(raw).toBase58();
      if (wallets.some((w) => w.address === pk)) {
        setAddError("That wallet is already in the list.");
        return;
      }
      const label =
        labelInput.trim() || `Wallet ${wallets.length + 1}`;
      update([...wallets, { address: pk, label }]);
      setAddressInput("");
      setLabelInput("");
      setAddError(null);
    } catch {
      setAddError("Not a valid Solana address.");
    }
  }

  function addConnected() {
    if (!publicKey) return;
    const pk = publicKey.toBase58();
    if (wallets.some((w) => w.address === pk)) return;
    update([...wallets, { address: pk, label: "Connected" }]);
  }

  function removeWallet(address: string) {
    update(wallets.filter((w) => w.address !== address));
  }

  function clearWallets() {
    update([]);
    setData(null);
    setError(null);
  }

  const connectedInView =
    publicKey && wallets.some((w) => w.address === publicKey.toBase58());

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[980px] flex-col px-4 pb-24 sm:px-5">
      <header className="flex h-[68px] shrink-0 items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15px] font-bold uppercase tracking-[0.16em] text-ink">
            OTC Desk Vaults
            <span className="cursor-blink inline-block h-[11px] w-[7px] rounded-[1px] bg-brand" />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            Desks, vault stock, and yield
          </p>
        </div>
        <nav className="ml-auto flex shrink-0 items-center gap-3">
          <ThemeToggle />
          <a
            href="https://x.com/OTCDesks"
            target="_blank"
            rel="noreferrer"
            aria-label="@OTCDesks"
            className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-well hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-[15px] w-[15px]">
              <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.22-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z" />
            </svg>
          </a>
          <a
            href="https://otcdesks.cash"
            target="_blank"
            rel="noreferrer"
            className="hidden text-[12px] text-muted-foreground hover:text-ink sm:inline"
          >
            otcdesks.cash
          </a>
        </nav>
      </header>

      <div className="mt-4 grid gap-4">
        <Frame title="Wallets" live>
          <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
            Add one wallet at a time. This browser remembers the list for next
            visit; the URL is shareable.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {wallets.map((w) => (
              <span
                key={w.address}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-well px-2.5 py-1 text-[11px]"
              >
                <span className="font-medium text-ink">{w.label}</span>
                <a
                  href={solscanAccount(w.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="tnum text-muted-foreground hover:text-head"
                  title={w.address}
                >
                  {shortAddress(w.address)}
                </a>
                <button
                  type="button"
                  aria-label={`Remove ${w.label}`}
                  className="text-muted-foreground hover:text-alert"
                  onClick={() => removeWallet(w.address)}
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))}
            {wallets.length === 0 ? (
              <span className="text-[12px] text-muted-foreground">
                No wallets yet — add an address to start.
              </span>
            ) : null}
          </div>
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              addWallet();
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="wallet-name" className="text-[11px] text-muted-foreground">
                Name
              </Label>
              <Input
                id="wallet-name"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="e.g. Trading"
                className="border-line bg-well text-[12px]"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="wallet-address" className="text-[11px] text-muted-foreground">
                Address
              </Label>
              <Input
                id="wallet-address"
                value={addressInput}
                onChange={(e) => {
                  setAddressInput(e.target.value);
                  if (addError) setAddError(null);
                }}
                placeholder="Solana address"
                className="border-line bg-well font-mono text-[12px]"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={!addressInput.trim()}>
                <Plus />
                Add wallet
              </Button>
            </div>
          </form>
          {addError ? (
            <p className="mt-1.5 text-[11px] text-alert">{addError}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setVisible(true)}
            >
              <Wallet />
              {connected ? "Connected" : "Connect"}
            </Button>
            {connected && publicKey && !connectedInView ? (
              <Button type="button" variant="outline" onClick={addConnected}>
                Add {shortAddress(publicKey.toBase58())}
              </Button>
            ) : null}
            {connected ? (
              <Button type="button" variant="ghost" onClick={() => disconnect()}>
                <Unplug />
                Disconnect
              </Button>
            ) : null}
            {wallets.length > 0 ? (
              <Button type="button" variant="ghost" onClick={clearWallets}>
                Clear list
              </Button>
            ) : null}
          </div>
        </Frame>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load the chain</AlertTitle>
            <AlertDescription className="text-[12px]">
              {error} Public RPC is rate-limited at times — wait a moment and
              retry, or set <code>SOLANA_RPC_URL</code> to any DAS-optional
              Solana endpoint (standard JSON-RPC is enough).
            </AlertDescription>
            <AlertAction>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Retry
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        {wallets.length > 0 || data || error || loading ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {data
                ? `On-chain snapshot · ${new Date(data.fetchedAt).toLocaleTimeString()}`
                : loading
                  ? "Reading program accounts…"
                  : "—"}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading || wallets.length === 0}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
          </div>
        ) : null}

        {loading && !data ? <LoadingState /> : null}
        {data ? <Results data={data} /> : null}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] bg-well" />
        ))}
      </div>
      <Skeleton className="h-40 bg-well" />
      <Skeleton className="h-56 bg-well" />
    </div>
  );
}

function Results({ data }: { data: PortfolioResponse }) {
  const y = data.yield;
  const desks = [...data.desks].sort((a, b) => a.serial - b.serial);
  const nextDeskEmpty = desks.length === 0;

  return (
    <>
      <Frame title="Protocol" live>
        <div className="flex flex-wrap items-stretch overflow-x-auto rounded-[9px] border border-line">
          <Stat
            label="Minted"
            value={`${fmtNum(data.protocol.minted, { max: 0 })} / ${fmtNum(data.protocol.maxSupply, { max: 0 })}`}
            tone="head"
          />
          <Stat
            label="Live desks"
            value={fmtNum(data.protocol.holders, { max: 0 })}
          />
          <Stat
            label="Pot"
            value={`${fmtNum(data.protocol.potSol, { max: 4 })} SOL`}
            tone="gold"
          />
          <Stat label="Buys next" value={data.protocol.nextTicker} tone="gold" />
          <Stat
            label="Paid to holders"
            value={fmtUsd(data.protocol.paidToHoldersUsd)}
            tone="phos"
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Round fires at {fmtNum(data.protocol.roundThresholdSol, { max: 2 })} SOL
          in the pot. Last round {fmtTime(data.protocol.lastRoundAt)}. Deposit
          burned per mint: {fmtOtc(data.protocol.depositRequired)} +{" "}
          {fmtNum(data.protocol.surchargeSol, { max: 2 })} SOL surcharge.{" "}
          <a
            href={solscanAccount(data.protocol.program)}
            className="underline decoration-line underline-offset-2 hover:text-head"
            target="_blank"
            rel="noreferrer"
          >
            Program
          </a>
          {" · "}
          <a
            href={solscanAccount(data.protocol.config)}
            className="underline decoration-line underline-offset-2 hover:text-head"
            target="_blank"
            rel="noreferrer"
          >
            Config
          </a>
          {" · "}
          <a
            href={solscanAccount(data.protocol.pot)}
            className="underline decoration-line underline-offset-2 hover:text-head"
            target="_blank"
            rel="noreferrer"
          >
            Pot
          </a>
        </p>
      </Frame>

      <Frame
        title="Derived yield"
        action={
          <Badge variant="outline" className="border-gold/40 text-gold">
            Not a published rate
          </Badge>
        }
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <MiniStat label="Est. APR" value={fmtPct(y.apr)} />
          <MiniStat
            label="USD / live desk"
            value={fmtUsd(y.usdPerLiveDesk)}
          />
          <MiniStat
            label="Your live desks / yr"
            value={
              data.totals.estimatedAnnualUsd == null
                ? "—"
                : fmtUsd(data.totals.estimatedAnnualUsd)
            }
          />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          {y.status === "ok"
            ? y.reason ??
              "Simple APR from paid-to-holders vs mint cost. Not a published rate."
            : y.reason}
        </p>
        {y.yearsElapsed != null ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            First mint {fmtTime(y.firstMintAt ?? 0)} ·{" "}
            {(y.yearsElapsed * 365.25).toFixed(1)} days elapsed · mint cost{" "}
            {fmtUsd(y.mintCostUsd)}.
          </p>
        ) : null}
      </Frame>

      <Frame title="Combined holdings">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-line hover:bg-transparent">
                <TableHead>Wallet</TableHead>
                <TableHead className="text-right">$OTC</TableHead>
                <TableHead className="text-right">Desks</TableHead>
                <TableHead className="text-right">Live</TableHead>
                <TableHead className="text-right">Vault USD</TableHead>
                <TableHead className="text-right">Owed USD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.wallets.map((w) => (
                <TableRow key={w.address} className="border-line">
                  <TableCell>
                    <div className="font-medium text-ink">{w.label}</div>
                    <a
                      href={solscanAccount(w.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="tnum text-[11px] text-muted-foreground hover:text-head"
                    >
                      {shortAddress(w.address, 6)}
                    </a>
                  </TableCell>
                  <TableCell className="tnum text-right">
                    {fmtNum(w.otc, { max: 2 })}
                    <div className="text-[11px] text-muted-foreground">
                      {fmtUsd(w.otcUsd)}
                    </div>
                  </TableCell>
                  <TableCell className="tnum text-right">{w.desks}</TableCell>
                  <TableCell className="tnum text-right">{w.liveDesks}</TableCell>
                  <TableCell className="tnum text-right">{fmtUsd(w.vaultUsd)}</TableCell>
                  <TableCell className="tnum text-right">{fmtUsd(w.owedUsd)}</TableCell>
                </TableRow>
              ))}
              {data.wallets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Add a wallet to inspect it.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
            <TableFooter>
              <TableRow className="border-line bg-well/60 hover:bg-well/60">
                <TableCell className="font-bold">Totals</TableCell>
                <TableCell className="tnum text-right font-bold">
                  {fmtNum(data.totals.otc, { max: 2 })}
                  <div className="text-[11px] font-normal text-muted-foreground">
                    {fmtUsd(data.totals.otcUsd)}
                  </div>
                </TableCell>
                <TableCell className="tnum text-right font-bold">
                  {data.totals.desks}
                </TableCell>
                <TableCell className="tnum text-right font-bold">
                  {data.totals.liveDesks}
                </TableCell>
                <TableCell className="tnum text-right font-bold">
                  {fmtUsd(data.totals.vaultUsd)}
                </TableCell>
                <TableCell className="tnum text-right font-bold">
                  {fmtUsd(data.totals.owedUsd)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </Frame>

      <Frame title="Desks & vaults">
        {nextDeskEmpty ? (
          <p className="text-[12.5px] text-muted-foreground">
            None of these wallets currently hold an OTC Desk NFT. Accrual is
            per desk; $OTC in a separate wallet is shown above and is not a
            claim on vault stock.
          </p>
        ) : (
          <div className="grid gap-2">
            {desks.map((desk) => (
              <DeskRow key={desk.asset} desk={desk} />
            ))}
          </div>
        )}
      </Frame>

      {data.warnings.length > 0 ? (
        <Alert>
          <AlertTitle>Partial data</AlertTitle>
          <AlertDescription className="text-[12px]">
            {data.warnings.join(" ")}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

function DeskRow({ desk }: { desk: DeskHolding }) {
  const totalUsd = desk.heldUsd + desk.owedUsd;
  return (
    <details className="group/desk rounded-lg border border-line bg-well/40 open:bg-well/55">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/desk:rotate-180" />
        <span className="tnum text-[14px] font-bold text-ink">#{desk.serial}</span>
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] uppercase tracking-[0.08em]",
            desk.activated
              ? "border-phos/40 bg-phos/10 text-phos"
              : "border-gold/40 text-gold",
          )}
        >
          {desk.activated ? "Live" : "Needs activate"}
        </Badge>
        <span className="tnum ml-auto text-[15px] font-bold text-ink">
          {fmtUsd(totalUsd)}
        </span>
      </summary>
      <div className="border-t border-line px-3 py-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>Burned {fmtOtc(desk.depositOtc)}</span>
          <span>Minted {fmtTime(desk.mintedAt)}</span>
          <a
            className="inline-flex items-center gap-0.5 hover:text-head"
            href={magicEdenItem(desk.asset)}
            target="_blank"
            rel="noreferrer"
          >
            Magic Eden <ExternalLink className="size-3" />
          </a>
          <a
            className="inline-flex items-center gap-0.5 hover:text-head"
            href={solscanAccount(desk.vault)}
            target="_blank"
            rel="noreferrer"
          >
            Vault <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="mt-2 grid gap-1">
          {desk.slots.map((slot) => {
            const qty = slot.held + slot.owed;
            const empty = qty === 0;
            return (
              <div
                key={slot.mint}
                className="flex items-center gap-2 text-[11.5px]"
              >
                <span
                  className={cn(
                    "w-[88px] shrink-0 font-medium",
                    empty ? "text-muted-foreground/60" : "text-ink",
                  )}
                >
                  {slot.symbol}
                </span>
                <span
                  className={cn(
                    "tnum grow text-right",
                    empty ? "text-muted-foreground/50" : "text-muted-foreground",
                  )}
                >
                  {fmtNum(qty, { max: 6 })}
                  {slot.owed > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-1 text-gold">·owed</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {fmtNum(slot.owed, { max: 6 })} credited
                        (counter − stamp) and not yet swept into the
                        vault ATA.
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "tnum w-[72px] shrink-0 text-right",
                    empty ? "text-muted-foreground/50" : "text-ink",
                  )}
                >
                  {empty ? "—" : fmtUsd(slot.usd)}
                </span>
                {!slot.open ? (
                  <span className="text-[10px] text-gold">closed</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "head" | "gold" | "phos";
}) {
  const color =
    tone === "head"
      ? "text-head"
      : tone === "gold"
        ? "text-gold"
        : tone === "phos"
          ? "text-phos"
          : "text-ink";
  return (
    <div className="min-w-[108px] grow basis-0 border-l border-line px-2.5 py-2 first:border-l-0">
      <div className="truncate text-[7px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("tnum mt-1 truncate text-[11px] font-bold leading-none", color)}>
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-well px-3 py-2">
      <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="tnum mt-1 text-[16px] font-bold text-ink">{value}</div>
    </div>
  );
}
