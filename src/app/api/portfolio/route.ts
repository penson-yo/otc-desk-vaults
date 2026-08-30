import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_RPC } from "@/lib/otc/constants";
import { loadPortfolio } from "@/lib/otc/portfolio";
import type { WatchWallet } from "@/lib/otc/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const raw = url.searchParams.getAll("address");
  const csv = url.searchParams.get("addresses");
  const fromCsv = csv
    ? csv.split(/[,\s]+/).filter(Boolean)
    : [];
  const addresses = [...raw, ...fromCsv];
  const labels = url.searchParams.getAll("label");

  if (addresses.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one address" },
      { status: 400 },
    );
  }

  const wallets: WatchWallet[] = addresses.map((address, i) => ({
    address,
    label: labels[i] || `Wallet ${i + 1}`,
  }));

  try {
    const data = await loadPortfolio(wallets);
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
