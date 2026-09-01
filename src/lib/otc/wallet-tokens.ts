import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { PublicKey, type ParsedAccountData } from "@solana/web3.js";
import {
  OTC_DECIMALS,
  RPC_CANDIDATES,
  STOCKS,
  USDC_DECIMALS,
  USDC_MINT,
  USDG_DECIMALS,
  USDG_MINT,
  WSOL_MINT,
  stockMeta,
} from "./constants";
import { uiAmount } from "./format";
import { lookupJupiterToken } from "./jupiter";
import { connection } from "./portfolio";
import { fetchSpotQuotes } from "./prices";

/** Leave enough native SOL to pay sequential Jupiter swap fees. */
export const SOL_SWAP_RESERVE_LAMPORTS = 20_000_000n;
export const DUST_USD = 0.05;

const WSOL = WSOL_MINT.toBase58();
const USDG = USDG_MINT.toBase58();
const USDC = USDC_MINT.toBase58();

export type WalletToken = {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  raw: string;
  swapRaw: string;
  amount: number;
  usd: number | null;
  priceUsd: number | null;
  isNative: boolean;
  program: "native" | "spl" | "token-2022";
  dust: boolean;
};

export type DestAsset = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
};

export type WalletTokensResponse = {
  address: string;
  fetchedAt: number;
  solLamports: string;
  tokens: WalletToken[];
  warnings: string[];
};

export type ParsedTokenInfo = {
  mint: string;
  state?: string;
  tokenAmount: {
    amount: string;
    decimals: number;
    uiAmount?: number | null;
  };
};

export function isLikelyNft(decimals: number, raw: bigint): boolean {
  return decimals === 0 && raw > 0n && raw <= 1n;
}

export function nativeSwapRaw(
  lamports: bigint,
  reserve: bigint = SOL_SWAP_RESERVE_LAMPORTS,
): bigint {
  if (lamports <= reserve) return 0n;
  return lamports - reserve;
}

export function isDustToken(
  usd: number | null,
  amount: number,
): boolean {
  if (usd != null && Number.isFinite(usd)) return usd < DUST_USD;
  return amount <= 0;
}

export function knownTokenMeta(
  mint: string,
  otcMint?: string | null,
): { symbol: string; name: string; decimals: number } | null {
  if (mint === WSOL) {
    return { symbol: "SOL", name: "Solana", decimals: 9 };
  }
  if (mint === USDG) {
    return { symbol: "USDG", name: "Global Dollar", decimals: USDG_DECIMALS };
  }
  if (mint === USDC) {
    return { symbol: "USDC", name: "USD Coin", decimals: USDC_DECIMALS };
  }
  if (otcMint && mint === otcMint) {
    return { symbol: "$OTC", name: "OTC", decimals: OTC_DECIMALS };
  }
  const stock = STOCKS[mint];
  if (stock) {
    return {
      symbol: stock.symbol,
      name: stock.company,
      decimals: stock.decimals,
    };
  }
  return null;
}

export function destinationPresets(otcMint?: string | null): DestAsset[] {
  const list: DestAsset[] = [
    { mint: USDG, symbol: "USDG", name: "Global Dollar", decimals: USDG_DECIMALS },
    { mint: USDC, symbol: "USDC", name: "USD Coin", decimals: USDC_DECIMALS },
    { mint: WSOL, symbol: "SOL", name: "Solana", decimals: 9 },
  ];
  if (otcMint) {
    list.push({
      mint: otcMint,
      symbol: "$OTC",
      name: "OTC",
      decimals: OTC_DECIMALS,
    });
  }
  return list;
}

export function tokenFromParsed(
  info: ParsedTokenInfo,
  program: "spl" | "token-2022",
): Omit<
  WalletToken,
  "symbol" | "name" | "usd" | "priceUsd" | "dust"
> | null {
  if (info.state === "frozen") return null;
  let raw: bigint;
  try {
    raw = BigInt(info.tokenAmount.amount);
  } catch {
    return null;
  }
  if (raw <= 0n) return null;
  const decimals = info.tokenAmount.decimals;
  if (isLikelyNft(decimals, raw)) return null;
  return {
    id: info.mint,
    mint: info.mint,
    decimals,
    raw: raw.toString(),
    swapRaw: raw.toString(),
    amount: uiAmount(raw, decimals),
    isNative: false,
    program,
  };
}

export function nativeSolToken(
  lamports: bigint,
  priceUsd: number | null,
): WalletToken {
  const amount = uiAmount(lamports, 9);
  const swapRaw = nativeSwapRaw(lamports);
  const usd = priceUsd != null ? amount * priceUsd : null;
  return {
    id: "native",
    mint: WSOL,
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    raw: lamports.toString(),
    swapRaw: swapRaw.toString(),
    amount,
    usd,
    priceUsd,
    isNative: true,
    program: "native",
    dust: isDustToken(usd, amount),
  };
}

export function mergeFungibleTokens(
  tokens: Array<Omit<WalletToken, "symbol" | "name" | "usd" | "priceUsd" | "dust">>,
): Array<Omit<WalletToken, "symbol" | "name" | "usd" | "priceUsd" | "dust">> {
  const map = new Map<
    string,
    Omit<WalletToken, "symbol" | "name" | "usd" | "priceUsd" | "dust">
  >();
  for (const token of tokens) {
    const key = token.isNative ? "native" : token.mint;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...token, id: key });
      continue;
    }
    const raw = BigInt(prev.raw) + BigInt(token.raw);
    const swapRaw = BigInt(prev.swapRaw) + BigInt(token.swapRaw);
    map.set(key, {
      ...prev,
      raw: raw.toString(),
      swapRaw: swapRaw.toString(),
      amount: uiAmount(raw, prev.decimals),
    });
  }
  return [...map.values()];
}

export function enrichToken(
  token: Omit<WalletToken, "symbol" | "name" | "usd" | "priceUsd" | "dust">,
  args: {
    otcMint?: string | null;
    prices: Record<string, number>;
    symbols: Record<string, string>;
    names: Record<string, string>;
  },
): WalletToken {
  const known = knownTokenMeta(token.mint, args.otcMint);
  const symbol = token.isNative
    ? "SOL"
    : token.mint === WSOL
      ? "WSOL"
      : (known?.symbol ?? args.symbols[token.mint] ?? stockMeta(token.mint).symbol);
  const name = token.isNative
    ? "Solana"
    : token.mint === WSOL
      ? "Wrapped SOL"
      : (known?.name ?? args.names[token.mint] ?? stockMeta(token.mint).company);
  const priceUsd = args.prices[token.mint] ?? null;
  const usd = priceUsd != null ? token.amount * priceUsd : null;
  return {
    ...token,
    symbol,
    name,
    usd,
    priceUsd,
    dust: isDustToken(usd, token.amount),
  };
}

export function sortWalletTokens(tokens: WalletToken[]): WalletToken[] {
  return [...tokens].sort((a, b) => {
    if (a.isNative !== b.isNative) return a.isNative ? -1 : 1;
    return (b.usd ?? -1) - (a.usd ?? -1);
  });
}

export function defaultSelectedIds(
  tokens: WalletToken[],
  outputMint: string,
): string[] {
  return tokens
    .filter(
      (t) =>
        t.mint !== outputMint &&
        !t.isNative &&
        !t.dust &&
        BigInt(t.swapRaw) > 0n,
    )
    .map((t) => t.id);
}

export function deskTickerMints(otcMint?: string | null): Set<string> {
  const set = new Set(Object.keys(STOCKS));
  if (otcMint) set.add(otcMint);
  return set;
}

export function selectDeskTickerIds(
  tokens: WalletToken[],
  outputMint: string,
  otcMint?: string | null,
): string[] {
  const tickers = deskTickerMints(otcMint);
  return tokens
    .filter(
      (t) =>
        tickers.has(t.mint) &&
        t.mint !== outputMint &&
        BigInt(t.swapRaw) > 0n,
    )
    .map((t) => t.id);
}

export function selectedSwapTotals(
  tokens: WalletToken[],
  selected: ReadonlySet<string>,
  outputMint: string,
): { id: string; mint: string; symbol: string; raw: bigint }[] {
  return tokens
    .filter(
      (t) =>
        selected.has(t.id) && t.mint !== outputMint && BigInt(t.swapRaw) > 0n,
    )
    .map((t) => ({
      id: t.id,
      mint: t.mint,
      symbol: t.symbol,
      raw: BigInt(t.swapRaw),
    }));
}

export function selectedUsd(
  tokens: WalletToken[],
  selected: ReadonlySet<string>,
): number | null {
  let sum = 0;
  let any = false;
  for (const t of tokens) {
    if (!selected.has(t.id)) continue;
    if (t.usd == null) continue;
    sum += t.usd;
    any = true;
  }
  return any ? sum : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String(err);
      const busy =
        msg.includes("429") ||
        msg.includes("Too many") ||
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("fetch failed");
      if (!busy || i === tries - 1) throw err;
      await sleep(400 * 2 ** i + Math.random() * 200);
    }
  }
  throw last;
}

function parsedInfo(data: ParsedAccountData | Buffer): ParsedTokenInfo | null {
  if (!data || typeof data !== "object" || !("parsed" in data)) return null;
  const info = (data as ParsedAccountData).parsed?.info as
    | {
        mint?: string;
        state?: string;
        tokenAmount?: { amount?: string; decimals?: number; uiAmount?: number | null };
      }
    | undefined;
  if (!info?.mint || !info.tokenAmount?.amount) return null;
  return {
    mint: info.mint,
    state: info.state,
    tokenAmount: {
      amount: String(info.tokenAmount.amount),
      decimals: Number(info.tokenAmount.decimals ?? 0),
      uiAmount: info.tokenAmount.uiAmount,
    },
  };
}

export async function loadWalletTokens(
  address: string,
  opts?: { otcMint?: string | null; rpc?: string },
): Promise<WalletTokensResponse> {
  const owner = new PublicKey(address).toBase58();
  const candidates = opts?.rpc ? [opts.rpc] : RPC_CANDIDATES;
  let last: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i]!;
    try {
      return await loadWalletTokensFrom(owner, url, opts?.otcMint);
    } catch (err) {
      last = err;
      if (i === candidates.length - 1) break;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function loadWalletTokensFrom(
  address: string,
  rpc: string,
  otcMint?: string | null,
): Promise<WalletTokensResponse> {
  const warnings: string[] = [];
  const conn = connection(rpc);
  const owner = new PublicKey(address);

  const [classic, token2022, lamports] = await withRetry(() =>
    Promise.all([
      conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      conn.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      conn.getBalance(owner),
    ]),
  );

  const parsed: Array<
    Omit<WalletToken, "symbol" | "name" | "usd" | "priceUsd" | "dust">
  > = [];
  for (const acc of classic.value) {
    const info = parsedInfo(acc.account.data);
    const token = info ? tokenFromParsed(info, "spl") : null;
    if (token) parsed.push(token);
  }
  for (const acc of token2022.value) {
    const info = parsedInfo(acc.account.data);
    const token = info ? tokenFromParsed(info, "token-2022") : null;
    if (token) parsed.push(token);
  }

  const merged = mergeFungibleTokens(parsed);
  const mints = [...new Set([WSOL, ...merged.map((t) => t.mint)])];
  const quotes = await fetchSpotQuotes(mints);
  const sol = nativeSolToken(BigInt(lamports), quotes.prices[WSOL] ?? null);
  const tokens = sortWalletTokens([
    sol,
    ...merged.map((t) =>
      enrichToken(t, {
        otcMint,
        prices: quotes.prices,
        symbols: quotes.symbols,
        names: quotes.names,
      }),
    ),
  ]);

  if (tokens.length === 1 && BigInt(sol.raw) === 0n) {
    warnings.push("No tokens found in this wallet.");
  }

  return {
    address,
    fetchedAt: Date.now(),
    solLamports: String(lamports),
    tokens,
    warnings,
  };
}

export async function loadTokenMeta(
  mint: string,
  opts?: { otcMint?: string | null; rpc?: string },
): Promise<DestAsset | null> {
  const pk = new PublicKey(mint);
  const mintKey = pk.toBase58();
  const known = knownTokenMeta(mintKey, opts?.otcMint);
  const candidates = opts?.rpc ? [opts.rpc] : RPC_CANDIDATES;
  let decimals: number | null = known?.decimals ?? null;
  let last: unknown;

  for (const url of candidates) {
    try {
      const conn = connection(url);
      const info = await withRetry(() => conn.getAccountInfo(pk));
      if (!info) continue;
      const unpacked = unpackMint(pk, info, info.owner);
      decimals = unpacked.decimals;
      last = null;
      break;
    } catch (err) {
      last = err;
    }
  }

  if (decimals == null) {
    const jup = await lookupJupiterToken(mintKey);
    if (jup) {
      return {
        mint: jup.mint,
        symbol: known?.symbol ?? jup.symbol,
        name: known?.name ?? jup.name,
        decimals: jup.decimals,
      };
    }
    if (last) throw last instanceof Error ? last : new Error(String(last));
    return null;
  }

  let symbol = known?.symbol;
  let name = known?.name;
  if (!symbol || !name) {
    const [quotes, jup] = await Promise.all([
      fetchSpotQuotes([mintKey]),
      lookupJupiterToken(mintKey),
    ]);
    symbol =
      symbol ?? quotes.symbols[mintKey] ?? jup?.symbol ?? `${mintKey.slice(0, 4)}…`;
    name = name ?? quotes.names[mintKey] ?? jup?.name ?? "Token";
  }

  return { mint: mintKey, symbol, name, decimals };
}
