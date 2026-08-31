import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { PROGRAM_ID } from "./constants";
import {
  CLAIM_DISCRIMINATOR,
  DISTRIBUTE_DISCRIMINATOR,
  SWEEP_DISCRIMINATOR,
  claimInstruction,
  distributeInstruction,
  packInstructionGroups,
  sweepInstruction,
} from "./instructions";
import {
  groupForSlot,
  groupInstructions,
  groupsToQueueItems,
  itemIdsForGroup,
  mintTotals,
  planClaim,
} from "./claim-plan";
import {
  configExtPda,
  configPda,
  poolStockAta,
  userStockAta,
  vaultExtPda,
  vaultStockAta,
} from "./pda";
import {
  broadcastAndConfirmRawTransaction,
  hasActiveTransferHook,
  packClaimBatches,
  sendClaimBatches,
} from "./run-claim";
import type { DeskHolding, SlotHolding } from "./types";

const USER = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSET = new PublicKey("So11111111111111111111111111111111111111112");
const MINT_A = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const MINT_B = new PublicKey("XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX");
const BLOCKHASH = new PublicKey(Uint8Array.from({ length: 32 }, () => 2)).toBase58();

function slot(partial: Partial<SlotHolding> & { index: number; mint: string }): SlotHolding {
  return {
    symbol: partial.symbol ?? "AAPLx",
    company: "Apple",
    decimals: 8,
    held: 0,
    owed: 0,
    usd: 0,
    open: true,
    priceUsd: 1,
    ...partial,
  };
}

function desk(partial: Partial<DeskHolding> & { owner: string }): DeskHolding {
  const vault = configPda(); // any valid pubkey
  return {
    asset: ASSET.toBase58(),
    vault: vault.toBase58(),
    serial: 12,
    name: "OTC Desk #12",
    activated: true,
    openMask: 0xffff,
    mintedAt: 0,
    depositOtc: 0,
    heldUsd: 0,
    owedUsd: 0,
    slots: [],
    ...partial,
  };
}

describe("instruction layouts", () => {
  it("serializes claim as 8-byte discriminator + u8 index", () => {
    const config = configPda();
    const ix = claimInstruction({
      user: USER,
      config,
      asset: ASSET,
      vault: ASSET,
      stockMint: MINT_A,
      index: 3,
    });
    assert.equal(ix.programId.toBase58(), PROGRAM_ID.toBase58());
    assert.deepEqual(Uint8Array.from(ix.data), Uint8Array.from([...CLAIM_DISCRIMINATOR, 3]));
    assert.equal(ix.keys.length, 12);
    assert.equal(ix.keys[0]!.pubkey.toBase58(), USER.toBase58());
    assert.equal(ix.keys[0]!.isSigner, true);
    assert.equal(ix.keys[0]!.isWritable, true);
    assert.equal(ix.keys[1]!.pubkey.toBase58(), config.toBase58());
    assert.equal(ix.keys[1]!.isWritable, false);
    assert.equal(ix.keys[2]!.pubkey.toBase58(), PROGRAM_ID.toBase58());
    assert.equal(ix.keys[3]!.pubkey.toBase58(), ASSET.toBase58());
    assert.equal(ix.keys[4]!.isWritable, true);
    assert.equal(ix.keys[5]!.pubkey.toBase58(), PROGRAM_ID.toBase58());
    assert.equal(ix.keys[7]!.pubkey.toBase58(), vaultStockAta(ASSET, MINT_A).toBase58());
    assert.equal(ix.keys[8]!.pubkey.toBase58(), userStockAta(USER, MINT_A).toBase58());
    assert.equal(ix.keys[9]!.pubkey.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58());
    assert.equal(ix.keys[10]!.pubkey.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  });

  it("serializes distribute with pool ATA of config", () => {
    const config = configPda();
    const vault = ASSET;
    const ix = distributeInstruction({
      config,
      vault,
      stockMint: MINT_A,
      index: 1,
    });
    assert.deepEqual(
      Uint8Array.from(ix.data),
      Uint8Array.from([...DISTRIBUTE_DISCRIMINATOR, 1]),
    );
    assert.equal(ix.keys.length, 8);
    assert.equal(ix.keys[0]!.isWritable, true);
    assert.equal(ix.keys[1]!.pubkey.toBase58(), PROGRAM_ID.toBase58());
    assert.equal(ix.keys[3]!.pubkey.toBase58(), PROGRAM_ID.toBase58());
    assert.equal(ix.keys[5]!.pubkey.toBase58(), poolStockAta(config, MINT_A).toBase58());
    assert.equal(ix.keys[6]!.pubkey.toBase58(), vaultStockAta(vault, MINT_A).toBase58());
  });

  it("serializes sweep with payer signer and ATA program", () => {
    const config = configPda();
    const ix = sweepInstruction({
      payer: USER,
      config,
      vault: ASSET,
      stockMint: MINT_A,
      index: 0,
    });
    assert.deepEqual(
      Uint8Array.from(ix.data),
      Uint8Array.from([...SWEEP_DISCRIMINATOR, 0]),
    );
    assert.equal(ix.keys.length, 11);
    assert.equal(ix.keys[0]!.isSigner, true);
    assert.equal(ix.keys[0]!.isWritable, true);
    assert.equal(ix.keys[2]!.pubkey.toBase58(), PROGRAM_ID.toBase58());
    assert.equal(ix.keys[4]!.pubkey.toBase58(), PROGRAM_ID.toBase58());
    assert.equal(ix.keys[10]!.pubkey.toBase58(), "11111111111111111111111111111111");
  });

  it("uses real extension PDAs for ticker 11", () => {
    const config = configPda();
    const claim = claimInstruction({
      user: USER,
      config,
      asset: ASSET,
      vault: ASSET,
      stockMint: MINT_A,
      index: 10,
    });
    assert.equal(claim.keys[2]!.pubkey.toBase58(), configExtPda().toBase58());
    assert.equal(claim.keys[2]!.isWritable, false);
    assert.equal(claim.keys[5]!.pubkey.toBase58(), vaultExtPda(ASSET).toBase58());

    const sweep = sweepInstruction({
      payer: USER,
      config,
      vault: ASSET,
      stockMint: MINT_A,
      index: 10,
    });
    assert.equal(sweep.keys[2]!.pubkey.toBase58(), configExtPda().toBase58());
    assert.equal(sweep.keys[2]!.isWritable, true);
    assert.equal(sweep.keys[4]!.pubkey.toBase58(), vaultExtPda(ASSET).toBase58());
  });
});

describe("claim plan", () => {
  const owner = USER.toBase58();

  it("skips tickers with zero held and zero owed", () => {
    const d = desk({
      owner,
      slots: [slot({ index: 0, mint: MINT_A.toBase58(), held: 0, owed: 0, open: true })],
    });
    assert.equal(planClaim([d], owner).length, 0);
    assert.equal(groupForSlot(d, d.slots[0]!), null);
  });

  it("uses distribute when owed and ATA is open, then claim", () => {
    const d = desk({
      owner,
      slots: [slot({ index: 2, mint: MINT_A.toBase58(), held: 0.1, owed: 0.2, open: true })],
    });
    const plan = planClaim([d], owner);
    assert.equal(plan.length, 1);
    assert.equal(plan[0]!.deliver, "distribute");
    assert.equal(plan[0]!.claim, true);
  });

  it("uses sweep when owed and ATA is closed", () => {
    const d = desk({
      owner,
      slots: [slot({ index: 0, mint: MINT_A.toBase58(), held: 0, owed: 1, open: false })],
    });
    const plan = planClaim([d], owner);
    assert.equal(plan[0]!.deliver, "sweep");
    assert.equal(plan[0]!.claim, true);
  });

  it("does not claim for watch-only addresses", () => {
    const d = desk({
      owner: MINT_A.toBase58(),
      slots: [slot({ index: 0, mint: MINT_A.toBase58(), held: 1, owed: 0, open: true })],
    });
    assert.equal(planClaim([d], owner).length, 0);
  });

  it("builds deliver then claim instructions in that order", () => {
    const d = desk({
      owner,
      asset: ASSET.toBase58(),
      vault: ASSET.toBase58(),
      slots: [slot({ index: 4, mint: MINT_A.toBase58(), held: 0, owed: 1, open: false })],
    });
    const group = planClaim([d], owner)[0]!;
    const ixs = groupInstructions(group, USER, configPda());
    assert.equal(ixs.length, 2);
    assert.deepEqual(Uint8Array.from(ixs[0]!.data.subarray(0, 8)), SWEEP_DISCRIMINATOR);
    assert.deepEqual(Uint8Array.from(ixs[1]!.data.subarray(0, 8)), CLAIM_DISCRIMINATOR);
    assert.equal(ixs[0]!.data[8], 4);
    assert.equal(ixs[1]!.data[8], 4);
  });

  it("aggregates the same ticker across desks for Jupiter", () => {
    const a = desk({
      owner,
      serial: 1,
      slots: [slot({ index: 0, mint: MINT_A.toBase58(), held: 1, owed: 1, decimals: 8 })],
    });
    const b = desk({
      owner,
      serial: 2,
      asset: MINT_B.toBase58(),
      slots: [slot({ index: 0, mint: MINT_A.toBase58(), held: 2, owed: 0, decimals: 8 })],
    });
    const totals = mintTotals(planClaim([a, b], owner));
    assert.equal(totals.length, 1);
    assert.equal(totals[0]!.uiAmount, 4);
  });
});

describe("transfer hook detection", () => {
  it("ignores absent and disabled transfer hooks", () => {
    assert.equal(hasActiveTransferHook(null), false);
    assert.equal(
      hasActiveTransferHook({
        authority: USER,
        programId: PublicKey.default,
      }),
      false,
    );
  });

  it("detects a non-default transfer hook program", () => {
    assert.equal(
      hasActiveTransferHook({
        authority: USER,
        programId: PROGRAM_ID,
      }),
      true,
    );
  });
});

describe("packing", () => {
  it("packs several claim groups without exceeding legacy size", () => {
    const owner = USER.toBase58();
    const desks: DeskHolding[] = [];
    for (let s = 0; s < 6; s++) {
      desks.push(
        desk({
          owner,
          serial: s,
          asset: new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? s + 1 : 3))).toBase58(),
          vault: new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? s + 10 : 4))).toBase58(),
          slots: [
            slot({ index: 0, mint: MINT_A.toBase58(), held: 1, owed: 1, open: true }),
            slot({ index: 1, mint: MINT_B.toBase58(), held: 1, owed: 0, open: true }),
          ],
        }),
      );
    }
    const groups = planClaim(desks, owner);
    assert.ok(groups.length >= 10);
    const batches = packClaimBatches(groups, USER, BLOCKHASH);
    assert.ok(batches.length >= 1);
    for (const batch of batches) {
      const tx = new Transaction().add(...batch.ixs);
      tx.feePayer = USER;
      tx.recentBlockhash = BLOCKHASH;
      const size = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).length;
      assert.ok(size <= 1232, `tx size ${size} > 1232`);
      assert.ok(batch.itemIds.length > 0);
    }
    const allIds = batches.flatMap((b) => b.itemIds);
    const expected = groups.flatMap((g) => itemIdsForGroup(g));
    assert.deepEqual(allIds.sort(), expected.sort());
  });

  it("does not split a sweep+claim group across transactions", () => {
    const ixsA = [
      sweepInstruction({
        payer: USER,
        config: configPda(),
        vault: ASSET,
        stockMint: MINT_A,
        index: 0,
      }),
      claimInstruction({
        user: USER,
        config: configPda(),
        asset: ASSET,
        vault: ASSET,
        stockMint: MINT_A,
        index: 0,
      }),
    ];
    const packed = packInstructionGroups([ixsA], USER, BLOCKHASH);
    assert.equal(packed.length, 1);
    assert.equal(packed[0]!.length, 2);
  });

  it("queue labels include desk serial and ticker", () => {
    const d = desk({
      owner: USER.toBase58(),
      serial: 42,
      slots: [slot({ index: 0, mint: MINT_A.toBase58(), symbol: "AAPLx", held: 0, owed: 1, open: false })],
    });
    const items = groupsToQueueItems(planClaim([d], USER.toBase58()));
    assert.ok(items.some((it) => it.label.includes("#42") && it.label.includes("AAPLx") && it.label.includes("sweep")));
    assert.ok(items.some((it) => it.label.includes("claim")));
  });

  it("confirms each signed transaction before requesting the next", async () => {
    const signer = Keypair.generate();
    const events: string[] = [];
    let signatureNumber = 0;
    const connection = {
      getLatestBlockhash: async () => ({
        blockhash: BLOCKHASH,
        lastValidBlockHeight: 999,
      }),
      sendRawTransaction: async () => {
        signatureNumber += 1;
        const signature = `signature-${signatureNumber}`;
        events.push(`broadcast:${signature}`);
        return signature;
      },
      getSignatureStatuses: async (signatures: string[]) => {
        events.push(`status:${signatures.join(",")}`);
        return {
          context: { slot: 1 },
          value: signatures.map(() => ({
            slot: 1,
            confirmations: 1,
            err: null,
            confirmationStatus: "confirmed" as const,
            status: { Ok: null },
          })),
        };
      },
    } as unknown as import("@solana/web3.js").Connection;
    const batches = [
      { ixs: [], itemIds: ["first"] },
      { ixs: [], itemIds: ["second"] },
    ];
    const items = [
      { id: "first", label: "First", status: "pending" as const },
      { id: "second", label: "Second", status: "pending" as const },
    ];

    const result = await sendClaimBatches({
      connection,
      user: signer.publicKey,
      batches,
      items,
      send: {
        sendTransaction: async () => {
          throw new Error("single-send path should not run");
        },
        signAllTransactions: async (transactions) => {
          transactions.forEach((transaction) => transaction.partialSign(signer));
          return transactions;
        },
      },
      onProgress: () => undefined,
    });

    assert.deepEqual(events, [
      "broadcast:signature-1",
      "status:signature-1",
      "broadcast:signature-2",
      "status:signature-2",
    ]);
    assert.ok(result.every((item) => item.status === "sent"));
  });

  it("rebroadcasts signed bytes while a signature is still pending", async () => {
    let sends = 0;
    let statusReads = 0;
    const connection = {
      sendRawTransaction: async () => {
        sends += 1;
        return "pending-signature";
      },
      getSignatureStatuses: async () => {
        statusReads += 1;
        return {
          context: { slot: 1 },
          value: [
            statusReads >= 5
              ? {
                  slot: 1,
                  confirmations: 1,
                  err: null,
                  confirmationStatus: "confirmed" as const,
                  status: { Ok: null },
                }
              : null,
          ],
        };
      },
      getBlockHeight: async () => 1,
    } as unknown as import("@solana/web3.js").Connection;

    const signature = await broadcastAndConfirmRawTransaction({
      connection,
      rawTransaction: Uint8Array.from([1, 2, 3]),
      blockhash: BLOCKHASH,
      lastValidBlockHeight: 999,
      pollIntervalMs: 1,
    });

    assert.equal(signature, "pending-signature");
    assert.equal(statusReads, 5);
    assert.ok(sends >= 2);
  });
});
