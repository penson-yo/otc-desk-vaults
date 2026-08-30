import { VersionedTransaction } from "@solana/web3.js";
import { OTC_DECIMALS } from "./constants";
import { uiAmount } from "./format";

export const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
export const JUPITER_SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
export const SLIPPAGE_BPS = 150;

export type JupiterQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct?: string;
  routePlan?: unknown;
};

export type SwapPreview = {
  mint: string;
  symbol: string;
  inAmount: bigint;
  outAmount: bigint | null;
  quote: JupiterQuote | null;
  skipped: boolean;
  reason?: string;
};

export async function quoteSwap(args: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps?: number;
}): Promise<JupiterQuote | null> {
  if (args.amount <= 0n) return null;
  if (args.inputMint === args.outputMint) return null;
  const params = new URLSearchParams({
    inputMint: args.inputMint,
    outputMint: args.outputMint,
    amount: args.amount.toString(),
    slippageBps: String(args.slippageBps ?? SLIPPAGE_BPS),
    swapMode: "ExactIn",
  });
  const res = await fetch(`${JUPITER_QUOTE_URL}?${params}`);
  if (!res.ok) return null;
  const json = (await res.json()) as JupiterQuote & { error?: string };
  if (!json.outAmount || json.error) return null;
  return json;
}

export async function buildSwapTransaction(args: {
  quote: JupiterQuote;
  userPublicKey: string;
}): Promise<VersionedTransaction> {
  const res = await fetch(JUPITER_SWAP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: args.quote,
      userPublicKey: args.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter swap build failed (${res.status}): ${text.slice(0, 180)}`);
  }
  const json = (await res.json()) as { swapTransaction?: string; error?: string };
  if (!json.swapTransaction) {
    throw new Error(json.error || "Jupiter did not return a swap transaction.");
  }
  const raw = decodeBase64(json.swapTransaction);
  return VersionedTransaction.deserialize(raw);
}

export async function previewSwaps(args: {
  totals: { mint: string; symbol: string; raw: bigint }[];
  otcMint: string;
  slippageBps?: number;
}): Promise<SwapPreview[]> {
  const out: SwapPreview[] = [];
  for (const t of args.totals) {
    if (t.mint === args.otcMint || t.raw <= 0n) {
      out.push({
        mint: t.mint,
        symbol: t.symbol,
        inAmount: t.raw,
        outAmount: null,
        quote: null,
        skipped: true,
        reason: "Nothing to swap",
      });
      continue;
    }
    try {
      const quote = await quoteSwap({
        inputMint: t.mint,
        outputMint: args.otcMint,
        amount: t.raw,
        slippageBps: args.slippageBps ?? SLIPPAGE_BPS,
      });
      if (!quote || BigInt(quote.outAmount) <= 0n) {
        out.push({
          mint: t.mint,
          symbol: t.symbol,
          inAmount: t.raw,
          outAmount: null,
          quote: null,
          skipped: true,
          reason: "No Jupiter quote",
        });
        continue;
      }
      out.push({
        mint: t.mint,
        symbol: t.symbol,
        inAmount: t.raw,
        outAmount: BigInt(quote.outAmount),
        quote,
        skipped: false,
      });
    } catch {
      out.push({
        mint: t.mint,
        symbol: t.symbol,
        inAmount: t.raw,
        outAmount: null,
        quote: null,
        skipped: true,
        reason: "Quote failed",
      });
    }
  }
  return out;
}

export function sumOtcOut(previews: SwapPreview[]): number {
  let raw = 0n;
  for (const p of previews) {
    if (p.outAmount != null) raw += p.outAmount;
  }
  return uiAmount(raw, OTC_DECIMALS);
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
