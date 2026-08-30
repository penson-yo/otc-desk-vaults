import { NextRequest, NextResponse } from "next/server";
import { RPC_CANDIDATES } from "@/lib/otc/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 1_000_000;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32600, message: "Payload too large" } },
      { status: 413 },
    );
  }
  try {
    JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  let lastStatus = 502;
  let lastBody = "";
  for (const url of RPC_CANDIDATES) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
      });
      const text = await res.text();
      lastStatus = res.status;
      lastBody = text;
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        continue;
      }
      return new NextResponse(text, {
        status: res.status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } catch {
      continue;
    }
  }

  if (lastBody) {
    return new NextResponse(lastBody, {
      status: lastStatus,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "All Solana RPC endpoints failed" },
    },
    { status: 502 },
  );
}
