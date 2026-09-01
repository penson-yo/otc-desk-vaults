import { NextRequest, NextResponse } from "next/server";
import {
  BREAK_EVEN_CACHE_CONTROL,
  loadBreakEven,
} from "@/lib/otc/breakeven";
import type { WatchWallet } from "@/lib/otc/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.getAll("address");
  const csv = req.nextUrl.searchParams.get("addresses");
  const addresses = [
    ...raw,
    ...(csv ? csv.split(/[,\s]+/).filter(Boolean) : []),
  ];
  const labels = req.nextUrl.searchParams.getAll("label");

  if (addresses.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one address" },
      { status: 400 },
    );
  }

  const wallets: WatchWallet[] = addresses.map((address, index) => ({
    address,
    label: labels[index] || `Wallet ${index + 1}`,
  }));

  try {
    const data = await loadBreakEven(wallets);
    return NextResponse.json(data, {
      headers: {
        "cache-control": BREAK_EVEN_CACHE_CONTROL,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
