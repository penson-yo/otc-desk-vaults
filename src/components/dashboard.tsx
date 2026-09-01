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
import {
  ClaimButtons,
  ClaimProgress,
  ClaimProvider,
} from "@/components/claim-actions";
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
import { MAGIC_EDEN_COLLECTION_SYMBOL } from "@/lib/otc/constants";
import {
  dexscreenerToken,
  fmtCompactUsd,
  fmtNum,
  fmtOtc,
  fmtPct,
  fmtTime,
  fmtUsd,
  magicEdenCollection,
  magicEdenItem,
  shortAddress,
  solscanAccount,
} from "@/lib/otc/format";
import type {
  BreakEvenResponse,
  DeskHolding,
  MarketSnapshot,
  PortfolioResponse,
  WatchWallet,
} from "@/lib/otc/types";
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
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [breakEven, setBreakEven] = useState<BreakEvenResponse | null>(null);
  const [breakEvenError, setBreakEvenError] = useState<string | null>(null);
  const [breakEvenLoading, setBreakEvenLoading] = useState(false);

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

  const loadBreakEven = useCallback(
    async (signal?: AbortSignal) => {
      if (wallets.length === 0) {
        setBreakEven(null);
        setBreakEvenError(null);
        setBreakEvenLoading(false);
        return;
      }
      setBreakEvenLoading(true);
      setBreakEvenError(null);
      const timeout = AbortSignal.timeout(58_000);
      const combined =
        signal != null ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const res = await fetch(`/api/breakeven?${query}`, {
          signal: combined,
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setBreakEven(json as BreakEvenResponse);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          if (!signal?.aborted) {
            setBreakEvenError("Break-even history timed out. Try refresh.");
          }
          return;
        }
        setBreakEvenError(err instanceof Error ? err.message : String(err));
      } finally {
        setBreakEvenLoading(false);
      }
    },
    [query, wallets.length],
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
    if (!hydrated) return;
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch when the watched wallets change
    void loadBreakEven(ac.signal);
    return () => ac.abort();
  }, [hydrated, loadBreakEven]);

  useEffect(() => {
    if (!hydrated || wallets.length === 0) return;
    const id = window.setInterval(() => {
      void load(undefined, { silent: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [hydrated, wallets.length, load]);

  useEffect(() => {
    const ac = new AbortController();
    async function loadMarket(signal: AbortSignal) {
      try {
        const timeout = AbortSignal.timeout(20_000);
        const combined = AbortSignal.any([signal, timeout]);
        const res = await fetch("/api/market", { signal: combined });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setMarket(json as MarketSnapshot);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
      }
    }
    void loadMarket(ac.signal);
    const id = window.setInterval(() => {
      void loadMarket(ac.signal);
    }, 60_000);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, []);

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
    setBreakEven(null);
    setBreakEvenError(null);
  }

  const connectedInView =
    publicKey && wallets.some((w) => w.address === publicKey.toBase58());

  return (
    <ClaimProvider
      data={data}
      connectedInView={!!connectedInView}
      loading={loading}
      onRefresh={() => load(undefined, { silent: true })}
    >
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
        <MarketStrip market={market} />
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
            <ClaimButtons />
            {wallets.length > 0 ? (
              <Button type="button" variant="ghost" onClick={clearWallets}>
                Clear list
              </Button>
            ) : null}
          </div>
          <ClaimProgress />
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
              onClick={() => {
                void load();
                void loadBreakEven();
              }}
              disabled={loading || wallets.length === 0}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
          </div>
        ) : null}

        {loading && !data ? <LoadingState /> : null}
        {data ? (
          <Results
            data={data}
            breakEven={breakEven}
            breakEvenError={breakEvenError}
            breakEvenLoading={breakEvenLoading}
            onRefreshBreakEven={() => void loadBreakEven()}
          />
        ) : null}
      </div>
    </div>
    </ClaimProvider>
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

function MarketStrip({ market }: { market: MarketSnapshot | null }) {
  const mint = market?.otcMint;
  const symbol = market?.collectionSymbol ?? MAGIC_EDEN_COLLECTION_SYMBOL;
  return (
    <Frame title="Market" live>
      <div className="flex flex-wrap items-stretch overflow-x-auto rounded-[9px] border border-line">
        <Stat
          label="OTC market cap"
          value={fmtCompactUsd(market?.otcMarketCapUsd)}
          hint={
            market?.otcPriceUsd != null
              ? `${fmtUsd(market.otcPriceUsd)} / OTC`
              : undefined
          }
          tone="phos"
          href={mint ? dexscreenerToken(mint) : undefined}
        />
        <Stat
          label="Desk floor"
          value={
            market?.nftFloorSol == null
              ? "—"
              : `${fmtNum(market.nftFloorSol, { max: 3, min: 2 })} SOL`
          }
          hint={
            market?.nftFloorUsd != null
              ? fmtUsd(market.nftFloorUsd)
              : undefined
          }
          tone="gold"
          href={magicEdenCollection(symbol)}
        />
      </div>
    </Frame>
  );
}

function Results({
  data,
  breakEven,
  breakEvenError,
  breakEvenLoading,
  onRefreshBreakEven,
}: {
  data: PortfolioResponse;
  breakEven: BreakEvenResponse | null;
  breakEvenError: string | null;
  breakEvenLoading: boolean;
  onRefreshBreakEven: () => void;
}) {
  const y = data.yield;
  const desks = [...data.desks].sort((a, b) => a.serial - b.serial);
  const nextDeskEmpty = desks.length === 0;
  const protocolDays =
    y.status === "ok" && y.yearsElapsed != null
      ? y.yearsElapsed * 365.25
      : null;
  const protocolDailyPerDesk =
    protocolDays != null && protocolDays > 0 && y.usdPerLiveDesk != null
      ? y.usdPerLiveDesk / protocolDays
      : null;
  const yourProtocolDaily =
    data.totals.estimatedAnnualUsd == null
      ? null
      : data.totals.estimatedAnnualUsd / 365.25;

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
          <Stat
            label="OTC market cap"
            value={fmtCompactUsd(data.protocol.otcMarketCapUsd)}
            hint={
              data.protocol.otcPriceUsd != null
                ? `${fmtUsd(data.protocol.otcPriceUsd)} / OTC`
                : undefined
            }
            tone="phos"
            href={dexscreenerToken(data.protocol.tokenMint)}
          />
          <Stat
            label="Desk floor"
            value={
              data.protocol.nftFloorSol == null
                ? "—"
                : `${fmtNum(data.protocol.nftFloorSol, { max: 3, min: 2 })} SOL`
            }
            hint={
              data.protocol.nftFloorUsd != null
                ? fmtUsd(data.protocol.nftFloorUsd)
                : undefined
            }
            tone="gold"
            href={magicEdenCollection(MAGIC_EDEN_COLLECTION_SYMBOL)}
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
            label="Paid / live desk total"
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
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <MiniStat
            label="Protocol / desk / day"
            value={fmtUsd(protocolDailyPerDesk)}
            hint="Lifetime protocol run-rate"
            tone="gold"
          />
          <MiniStat
            label="Your live desks / day"
            value={fmtUsd(yourProtocolDaily)}
            hint={`${data.totals.liveDesks} live desk${data.totals.liveDesks === 1 ? "" : "s"} · protocol run-rate`}
            tone="gold"
          />
          <MiniStat
            label="Actual since purchase / day"
            value={fmtUsd(breakEven?.dailyRewardsUsd)}
            hint="Your current-marked rewards · not a forecast"
            tone="phos"
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
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Protocol daily figures spread lifetime paid-to-holders across days
          since the first mint. Actual since purchase uses your claimed and
          unclaimed rewards divided by the combined days you have held each desk.
        </p>
      </Frame>

      <BreakEvenPanel
        key={data.wallets
          .map((wallet) => wallet.address)
          .sort()
          .join(",")}
        data={breakEven}
        error={breakEvenError}
        loading={breakEvenLoading}
        onRefresh={onRefreshBreakEven}
        walletKey={data.wallets
          .map((wallet) => wallet.address)
          .sort()
          .join(",")}
      />

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

      <Frame
        title="Desks & vaults"
        action={<ClaimButtons size="sm" />}
      >
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

function BreakEvenPanel({
  data,
  error,
  loading,
  onRefresh,
  walletKey,
}: {
  data: BreakEvenResponse | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  walletKey: string;
}) {
  const overrideStorageKey = `otc-desk-vaults:claimed-usdg:${walletKey}`;
  const [claimedOverride, setClaimedOverride] = useState(() => {
    try {
      return localStorage.getItem(overrideStorageKey) ?? "";
    } catch {
      return "";
    }
  });

  const updateClaimedOverride = (value: string) => {
    setClaimedOverride(value);
    try {
      if (value === "") localStorage.removeItem(overrideStorageKey);
      else localStorage.setItem(overrideStorageKey, value);
    } catch {
      // ignore
    }
  };

  const action = (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className="border-gold/40 text-gold">
        Realized + current
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh break-even"
        onClick={onRefresh}
        disabled={loading}
      >
        {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      </Button>
    </div>
  );

  if (!data && loading) {
    return (
      <Frame title="Break-even" action={action}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[76px] bg-well" />
          ))}
        </div>
        <Skeleton className="mt-3 h-28 bg-well" />
      </Frame>
    );
  }

  if (!data) {
    return (
      <Frame title="Break-even" action={action}>
        <p className="text-[12px] text-muted-foreground">
          {error ?? "No Magic Eden purchase history found for these desks."}
        </p>
      </Frame>
    );
  }

  const fullInstantExit = data.instantExitDesks === data.basisDesks;
  const exitHint =
    data.instantExitSol == null
      ? "No executable bids found"
      : `${data.instantExitDesks}/${data.basisDesks} desks have bid depth`;
  const parsedOverride = Number(claimedOverride);
  const overrideUsd =
    claimedOverride !== "" && Number.isFinite(parsedOverride) && parsedOverride >= 0
      ? parsedOverride
      : null;
  const realizedRewardsUsd = overrideUsd ?? data.realizedRewardsUsd;
  const totalRewardsUsd =
    realizedRewardsUsd +
    data.unsoldClaimedRewardsUsd +
    data.unclaimedRewardsUsd;
  const rewardsOnlyRemainingUsd = Math.max(
    0,
    data.costBasisUsd - totalRewardsUsd,
  );
  const rewardsRecovery =
    data.costBasisUsd > 0 ? totalRewardsUsd / data.costBasisUsd : null;
  const rewardScale =
    data.totalRewardsUsd > 0 ? totalRewardsUsd / data.totalRewardsUsd : 1;
  const dailyRewardsUsd =
    data.dailyRewardsUsd == null ? null : data.dailyRewardsUsd * rewardScale;
  const rewardsOnlyEtaDays =
    rewardsOnlyRemainingUsd === 0
      ? 0
      : dailyRewardsUsd != null && dailyRewardsUsd > 0
        ? rewardsOnlyRemainingUsd / dailyRewardsUsd
        : null;
  const rewardAdjustmentUsd = totalRewardsUsd - data.totalRewardsUsd;
  const economicPnlUsd =
    data.economicPnlUsd == null
      ? null
      : data.economicPnlUsd + rewardAdjustmentUsd;
  const instantExitEconomicPnlUsd =
    data.instantExitEconomicPnlUsd == null
      ? null
      : data.instantExitEconomicPnlUsd + rewardAdjustmentUsd;
  const visibleWarnings = data.warnings.map((warning) =>
    warning.startsWith("Claim history failed")
      ? "Automatic reward history is temporarily unavailable. Enter claimed USDG above."
      : warning,
  );

  return (
    <Frame title="Break-even" action={action}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <MiniStat
          label="Cost basis"
          value={`${fmtNum(data.costBasisSol, { max: 3, min: 2 })} SOL`}
          hint={`${fmtUsd(data.costBasisUsd)} at current SOL`}
        />
        <MiniStat
          label="Rewards accrued"
          value={fmtUsd(totalRewardsUsd)}
          hint={`${fmtUsd(realizedRewardsUsd)} received USDG · ${fmtUsd(data.unsoldClaimedRewardsUsd + data.unclaimedRewardsUsd)} unsold/vault`}
          tone="phos"
        />
        <MiniStat
          label="Net cost remaining"
          value={fmtUsd(rewardsOnlyRemainingUsd)}
          hint={
            rewardsOnlyRemainingUsd === 0
              ? `${fmtPct(rewardsRecovery)} recovered · rewards break-even reached`
              : `${fmtPct(rewardsRecovery)} of cost basis recovered`
          }
          tone={rewardsOnlyRemainingUsd === 0 ? "phos" : "gold"}
        />
        <MiniStat
          label="Floor exit"
          value={
            data.floorValueSol == null
              ? "—"
              : `${fmtNum(data.floorValueSol, { max: 3 })} SOL`
          }
          hint={`With rewards: ${fmtSignedUsd(economicPnlUsd)}`}
          tone={pnlTone(economicPnlUsd)}
        />
        <MiniStat
          label="Exit now"
          value={
            data.instantExitSol == null
              ? "—"
              : `${fmtNum(data.instantExitSol, { max: 3 })} SOL`
          }
          hint={
            fullInstantExit
              ? `With rewards: ${fmtSignedUsd(instantExitEconomicPnlUsd)}`
              : exitHint
          }
          tone={pnlTone(instantExitEconomicPnlUsd)}
        />
        <MiniStat
          label="Rewards-only ETA"
          value={fmtEta(rewardsOnlyEtaDays)}
          hint={
            rewardsOnlyRemainingUsd === 0
              ? "Cost recovered by rewards"
              : `${fmtUsd(rewardsOnlyRemainingUsd)} left at ${fmtUsd(dailyRewardsUsd)}/day`
          }
          tone="gold"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-well/40 px-3 py-2">
        <Label htmlFor="claimed-usdg" className="text-[11px] text-muted-foreground">
          Claimed USDG received
        </Label>
        <Input
          id="claimed-usdg"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={claimedOverride}
          onChange={(event) => updateClaimedOverride(event.target.value)}
          placeholder={data.realizedRewardsUsd.toFixed(2)}
          className="h-8 w-32 tnum"
        />
        <span className="text-[10px] text-muted-foreground">
          Optional browser-saved override when RPC history is incomplete.
        </span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <Table>
          <TableHeader>
            <TableRow className="border-line hover:bg-transparent">
              <TableHead>Desk</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Rewards</TableHead>
              <TableHead className="text-right">Floor</TableHead>
              <TableHead className="text-right">Exit now</TableHead>
              <TableHead className="text-right">Floor P/L</TableHead>
              <TableHead className="text-right">Sell</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.desks.map((desk) => (
              <TableRow key={desk.asset} className="border-line">
                <TableCell>
                  <div className="tnum font-bold text-ink">#{desk.serial}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(desk.purchasedAt * 1_000).toLocaleDateString()}
                  </div>
                </TableCell>
                <TableCell className="tnum text-right">
                  {fmtNum(desk.costSol, { max: 3 })} SOL
                </TableCell>
                <TableCell className="tnum text-right">
                  {fmtUsd(desk.totalRewardsUsd)}
                </TableCell>
                <TableCell className="tnum text-right">
                  {fmtUsd(desk.floorUsd)}
                </TableCell>
                <TableCell className="tnum text-right">
                  {desk.assignedExitNetSol == null
                    ? "—"
                    : `${fmtNum(desk.assignedExitNetSol, { max: 3 })} SOL`}
                  {desk.bestBidNetSol != null ? (
                    <div className="text-[10px] text-muted-foreground">
                      best {fmtNum(desk.bestBidNetSol, { max: 3 })}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell
                  className={cn(
                    "tnum text-right",
                    desk.economicPnlUsd != null && desk.economicPnlUsd >= 0
                      ? "text-phos"
                      : "text-alert",
                  )}
                >
                  {fmtSignedUsd(desk.economicPnlUsd)}
                </TableCell>
                <TableCell className="text-right">
                  <a
                    href={magicEdenItem(desk.asset)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-head hover:underline"
                  >
                    Magic Eden <ExternalLink className="size-3" />
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Floor exit assumes every desk sells at the current collection floor.
        Exit now consumes unique live Magic Eden bid capacity, so one bid is not
        counted four times. {data.methodology}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        The links open each desk on Magic Eden. Automatic claim-then-sell is not
        enabled because Magic Eden does not expose a verified public Core NFT
        sell builder for this app; no sale will be signed without your wallet.
      </p>
      {visibleWarnings.length > 0 || error ? (
        <p className="mt-2 text-[11px] leading-relaxed text-gold">
          {[...new Set([...visibleWarnings, ...(error ? [error] : [])])].join(
            " ",
          )}
        </p>
      ) : null}
    </Frame>
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
  hint,
  tone = "ink",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "head" | "gold" | "phos";
  href?: string;
}) {
  const color =
    tone === "head"
      ? "text-head"
      : tone === "gold"
        ? "text-gold"
        : tone === "phos"
          ? "text-phos"
          : "text-ink";
  const inner = (
    <>
      <div className="truncate text-[7px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("tnum mt-1 truncate text-[11px] font-bold leading-none", color)}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1 truncate text-[10px] text-muted-foreground">{hint}</div>
      ) : null}
    </>
  );
  const className =
    "min-w-[108px] grow basis-0 border-l border-line px-2.5 py-2 first:border-l-0";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(className, "hover:bg-well/60")}
      >
        {inner}
      </a>
    );
  }
  return <div className={className}>{inner}</div>;
}

function MiniStat({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "phos" | "gold" | "alert";
}) {
  const color =
    tone === "phos"
      ? "text-phos"
      : tone === "gold"
        ? "text-gold"
        : tone === "alert"
          ? "text-alert"
          : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-well px-3 py-2">
      <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("tnum mt-1 text-[16px] font-bold", color)}>{value}</div>
      {hint ? (
        <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function fmtSignedUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${fmtUsd(Math.abs(value))}`;
}

function fmtEta(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days <= 0) return "Recovered";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} hr`;
  return `${fmtNum(days, { max: 1 })} days`;
}

function pnlTone(value: number | null): "ink" | "phos" | "alert" {
  if (value == null) return "ink";
  return value >= 0 ? "phos" : "alert";
}
