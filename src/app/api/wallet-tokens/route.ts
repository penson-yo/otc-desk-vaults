import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { PUBLIC_RPC } from "@/lib/otc/constants";
import { loadWalletTokens } from "@/lib/otc/wallet-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  const otcMint = req.nextUrl.searchParams.get("otcMint")?.trim() || undefined;
  if (!address) {
    return NextResponse.json(
      { error: "Provide a wallet address" },
      { status: 400 },
    );
  }
  try {
    new PublicKey(address);
    if (otcMint) new PublicKey(otcMint);
  } catch {
    return NextResponse.json(
      { error: "Not a valid Solana address" },
      { status: 400 },
    );
  }

  try {
    const data = await loadWalletTokens(address, { otcMint });
    return NextResponse.json(data, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, rpc: PUBLIC_RPC },
      { status: 502 },
    );
  }
}
