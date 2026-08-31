import { NextRequest, NextResponse } from "next/server";
import { RPC_CANDIDATES } from "@/lib/otc/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 1_000_000;

type RpcRequest = {
  id?: unknown;
  jsonrpc?: string;
  method?: string;
};

type RpcReply = {
  error?: unknown;
  result?: unknown;
};

async function forwardRpc(url: string, raw: string) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    let json: RpcReply | null = null;
    try {
      json = JSON.parse(text) as RpcReply;
    } catch {
      // Preserve the raw upstream response for the normal fallback path.
    }
    return { status: res.status, text, json };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32600, message: "Payload too large" } },
      { status: 413 },
    );
  }
  let request: RpcRequest;
  try {
    request = JSON.parse(raw) as RpcRequest;
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  if (
    request.method === "sendTransaction" ||
    request.method === "getSignatureStatuses"
  ) {
    const replies = (
      await Promise.all(RPC_CANDIDATES.map((url) => forwardRpc(url, raw)))
    ).filter((reply) => reply !== null);

    if (request.method === "sendTransaction") {
      const accepted = replies.find(
        (reply) => reply.json?.result != null && reply.json.error == null,
      );
      if (accepted) {
        return new NextResponse(accepted.text, {
          status: accepted.status,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        });
      }
    } else {
      const results = replies
        .map((reply) => reply.json?.result)
        .filter(
          (result): result is { context?: { slot?: number }; value: unknown[] } =>
            !!result &&
            typeof result === "object" &&
            "value" in result &&
            Array.isArray((result as { value?: unknown }).value),
        );
      if (results.length > 0) {
        const width = Math.max(...results.map((result) => result.value.length));
        const value = Array.from({ length: width }, (_, index) =>
          results.map((result) => result.value[index]).find(Boolean) ?? null,
        );
        const slot = Math.max(
          0,
          ...results.map((result) => result.context?.slot ?? 0),
        );
        return NextResponse.json(
          {
            jsonrpc: request.jsonrpc ?? "2.0",
            id: request.id,
            result: { context: { slot }, value },
          },
          { headers: { "cache-control": "no-store" } },
        );
      }
    }
  }

  let lastStatus = 502;
  let lastBody = "";
  for (const url of RPC_CANDIDATES) {
    const reply = await forwardRpc(url, raw);
    if (!reply) continue;
    lastStatus = reply.status;
    lastBody = reply.text;
    if (
      reply.status === 403 ||
      reply.status === 429 ||
      reply.status >= 500
    ) {
      continue;
    }
    return new NextResponse(reply.text, {
      status: reply.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
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
