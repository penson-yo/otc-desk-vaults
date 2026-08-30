import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { uiToRaw } from "./format";
import {
  claimInstruction,
  distributeInstruction,
  sweepInstruction,
} from "./instructions";
import type { DeskHolding, SlotHolding } from "./types";

export type DeliverKind = "distribute" | "sweep";

export type ClaimGroup = {
  deskSerial: number;
  asset: string;
  vault: string;
  mint: string;
  symbol: string;
  decimals: number;
  index: number;
  deliver: DeliverKind | null;
  claim: boolean;
  held: number;
  owed: number;
};

export type QueueItem = {
  id: string;
  label: string;
  status: "pending" | "signed" | "sent" | "failed" | "skipped";
  error?: string;
  signature?: string;
};

export function ownedDesks(
  desks: DeskHolding[],
  owner: string,
): DeskHolding[] {
  return desks.filter((d) => d.owner === owner);
}

/** Skip empty tickers. Prefer sweep when the vault ATA is not open. */
export function planClaim(
  desks: DeskHolding[],
  owner: string,
): ClaimGroup[] {
  const out: ClaimGroup[] = [];
  for (const desk of ownedDesks(desks, owner)) {
    for (const slot of desk.slots) {
      const group = groupForSlot(desk, slot);
      if (group) out.push(group);
    }
  }
  return out;
}

export function groupForSlot(
  desk: DeskHolding,
  slot: SlotHolding,
): ClaimGroup | null {
  if (slot.held <= 0 && slot.owed <= 0) return null;
  let deliver: DeliverKind | null = null;
  if (slot.owed > 0) {
    deliver = slot.open ? "distribute" : "sweep";
  } else if (!slot.open) {
    // Held but flagged closed: sweep opens the ATA, then claim.
    deliver = "sweep";
  }
  return {
    deskSerial: desk.serial,
    asset: desk.asset,
    vault: desk.vault,
    mint: slot.mint,
    symbol: slot.symbol,
    decimals: slot.decimals,
    index: slot.index,
    deliver,
    claim: true,
    held: slot.held,
    owed: slot.owed,
  };
}

export function hasClaimable(desks: DeskHolding[], owner: string): boolean {
  return planClaim(desks, owner).length > 0;
}

export function groupInstructions(
  group: ClaimGroup,
  user: PublicKey,
  config: PublicKey,
): TransactionInstruction[] {
  const vault = new PublicKey(group.vault);
  const stockMint = new PublicKey(group.mint);
  const asset = new PublicKey(group.asset);
  const ixs: TransactionInstruction[] = [];
  if (group.deliver === "distribute") {
    ixs.push(
      distributeInstruction({
        config,
        vault,
        stockMint,
        index: group.index,
      }),
    );
  } else if (group.deliver === "sweep") {
    ixs.push(
      sweepInstruction({
        payer: user,
        config,
        vault,
        stockMint,
        index: group.index,
      }),
    );
  }
  if (group.claim) {
    ixs.push(
      claimInstruction({
        user,
        config,
        asset,
        vault,
        stockMint,
        index: group.index,
      }),
    );
  }
  return ixs;
}

export function groupsToQueueItems(groups: ClaimGroup[]): QueueItem[] {
  const items: QueueItem[] = [];
  for (const g of groups) {
    if (g.deliver) {
      items.push({
        id: itemId(g, g.deliver),
        label: `#${g.deskSerial} ${g.symbol} · ${g.deliver}`,
        status: "pending",
      });
    }
    if (g.claim) {
      items.push({
        id: itemId(g, "claim"),
        label: `#${g.deskSerial} ${g.symbol} · claim`,
        status: "pending",
      });
    }
  }
  return items;
}

export function itemId(
  group: Pick<ClaimGroup, "asset" | "mint">,
  kind: string,
): string {
  return `${group.asset}:${group.mint}:${kind}`;
}

export function itemIdsForGroup(group: ClaimGroup): string[] {
  const ids: string[] = [];
  if (group.deliver) ids.push(itemId(group, group.deliver));
  if (group.claim) ids.push(itemId(group, "claim"));
  return ids;
}

export type MintTotal = {
  mint: string;
  symbol: string;
  decimals: number;
  uiAmount: number;
  raw: bigint;
};

/** Sum held+owed per ticker across owned desks (post-claim they share one ATA). */
export function mintTotals(groups: ClaimGroup[]): MintTotal[] {
  const map = new Map<string, MintTotal>();
  for (const g of groups) {
    const qty = (g.held > 0 ? g.held : 0) + (g.owed > 0 ? g.owed : 0);
    const prev = map.get(g.mint);
    if (prev) {
      prev.uiAmount += qty;
      prev.raw += uiToRaw(qty, g.decimals);
    } else {
      map.set(g.mint, {
        mint: g.mint,
        symbol: g.symbol,
        decimals: g.decimals,
        uiAmount: qty,
        raw: uiToRaw(qty, g.decimals),
      });
    }
  }
  return [...map.values()].filter((t) => t.raw > 0n);
}

export function explainTxError(err: unknown): string {
  const msg = errorText(err);
  if (/user rejected|rejected the request|cancelled/i.test(msg)) {
    return "Cancelled in wallet.";
  }
  if (msg.includes("UndistributedBalance")) {
    return "Distribute this ticker before withdrawing it.";
  }
  if (msg.includes("AtaNotOpen")) {
    return "Open the vault ATA first (sweep).";
  }
  if (msg.includes("NothingToWithdraw")) {
    return "Nothing to claim for this ticker.";
  }
  if (/429|rate-limit|Too many/i.test(msg)) {
    return "RPC rate-limited. Retry in a moment.";
  }
  if (/403|Access forbidden/i.test(msg)) {
    return "Solana RPC blocked the request. Retry, or set SOLANA_RPC_URL to a private endpoint.";
  }
  if (/TransferHook|transfer hook/i.test(msg)) {
    return "Transfer hook requires extra accounts; skipped.";
  }
  return msg.slice(0, 220);
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const logs =
      "logs" in err && Array.isArray((err as { logs?: string[] }).logs)
        ? (err as { logs: string[] }).logs.join(" ")
        : "";
    return `${err.message} ${logs}`.trim();
  }
  return String(err);
}
