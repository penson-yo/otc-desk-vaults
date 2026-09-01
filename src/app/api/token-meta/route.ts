import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { PUBLIC_RPC } from "@/lib/otc/constants";
import { loadTokenMeta } from "@/lib/otc/wallet-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint")?.trim() ?? "";
  const otcMint = req.nextUrl.searchParams.get("otcMint")?.trim() || undefined;
  if (!mint) {
    return NextResponse.json({ error: "Provide a mint" }, { status: 400 });
  }
  try {
    new PublicKey(mint);
    if (otcMint) new PublicKey(otcMint);
  } catch {
    return NextResponse.json(
      { error: "Not a valid Solana mint" },
      { status: 400 },
    );
  }

  try {
    const data = await loadTokenMeta(mint, { otcMint });
    if (!data) {
      return NextResponse.json(
        { error: "Mint account not found" },
        { status: 404 },
      );
    }
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
