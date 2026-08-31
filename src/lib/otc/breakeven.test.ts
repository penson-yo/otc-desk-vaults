import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignInstantExitBids,
  calculateBreakEven,
  matchCurrentPurchases,
} from "./breakeven";
import { WSOL_MINT } from "./constants";
import type { DeskHolding, PortfolioResponse } from "./types";

function desk(asset: string, vault: string, serial: number): DeskHolding {
  return {
    asset,
    vault,
    serial,
    name: `Desk #${serial}`,
    owner: "wallet",
    activated: true,
    openMask: 0,
    mintedAt: 0,
    depositOtc: 0,
    heldUsd: 2,
    owedUsd: 3,
    slots: [],
  };
}

describe("Magic Eden cost basis", () => {
  it("matches current desks to the latest buyNow and ignores duplicate bid activity", () => {
    const desks = [desk("asset-a", "vault-a", 1)];
    const purchases = matchCurrentPurchases({
      wallet: "wallet",
      desks,
      activities: [
        {
          type: "buyNow",
          collectionSymbol: "otc_desks",
          buyer: "wallet",
          tokenMint: "asset-a",
          blockTime: 100,
          price: 1.1,
        },
        {
          type: "bid",
          collectionSymbol: "otc_desks",
          buyer: "wallet",
          tokenMint: "asset-a",
          blockTime: 100,
          price: 1.1,
        },
        {
          type: "buyNow",
          collectionSymbol: "otc_desks",
          buyer: "wallet",
          tokenMint: "asset-a",
          blockTime: 200,
          price: 1.2,
        },
      ],
    });

    assert.equal(purchases.length, 1);
    assert.equal(purchases[0]!.costSol, 1.2);
    assert.equal(purchases[0]!.purchasedAt, 200);
  });
});

describe("instant-exit depth", () => {
  it("does not multiply one pool across every desk", () => {
    const shared = {
      poolKey: "shared",
      spotPrice: 10e9,
      buyPriceTaker: 10e9,
      buyOrdersAmount: 1,
      buysidePaymentAmount: 10e9,
      curveDelta: 0,
    };
    const bids = new Map([
      [
        "asset-a",
        [
          shared,
          {
            poolKey: "a-only",
            spotPrice: 8e9,
            buyPriceTaker: 8e9,
            buyOrdersAmount: 1,
            buysidePaymentAmount: 8e9,
            curveDelta: 0,
          },
        ],
      ],
      [
        "asset-b",
        [
          { ...shared, buyPriceTaker: 9.5e9 },
        ],
      ],
    ]);

    const assigned = assignInstantExitBids({
      assets: ["asset-a", "asset-b"],
      bidsByAsset: bids,
      now: 1,
    });

    assert.equal(assigned.length, 2);
    assert.equal(
      assigned.reduce((sum, bid) => sum + bid.netSol, 0),
      17.5,
    );
  });
});

describe("break-even calculation", () => {
  it("separates reward-only payback from floor-based economics", () => {
    const desks = [desk("asset-a", "vault-a", 1), desk("asset-b", "vault-b", 2)];
    const portfolio = {
      fetchedAt: 0,
      rpc: "rpc",
      protocol: {
        program: "",
        config: "",
        pot: "",
        collection: "",
        tokenMint: "reward-mint",
        protocolWallet: "",
        minted: 2,
        holders: 2,
        maxSupply: 2,
        potSol: 0,
        roundThresholdSol: 0,
        nextTicker: "",
        lastRoundAt: 0,
        minRoundInterval: 0,
        depositRequired: 0,
        surchargeSol: 0,
        otcBurned: null,
        paidToHoldersUsd: null,
        otcPriceUsd: null,
        otcMarketCapUsd: null,
        nftFloorSol: 1.5,
        nftFloorUsd: 150,
      },
      prices: {
        [WSOL_MINT.toBase58()]: 100,
        "reward-mint": 2,
      },
      yield: {
        status: "unavailable",
        reason: null,
        formula: "",
        paidToHoldersUsd: null,
        usdPerLiveDesk: null,
        yearsElapsed: null,
        firstMintAt: null,
        mintCostUsd: null,
        apr: null,
        apy: null,
        derived: true,
      },
      wallets: [],
      desks,
      totals: {
        otc: 0,
        otcUsd: 0,
        desks: 2,
        liveDesks: 2,
        vaultUsd: 4,
        owedUsd: 6,
        estimatedAnnualUsd: null,
      },
      warnings: [],
    } satisfies PortfolioResponse;

    const result = calculateBreakEven({
      portfolio,
      purchases: desks.map((item) => ({
        wallet: "wallet",
        asset: item.asset,
        vault: item.vault,
        serial: item.serial,
        purchasedAt: 86_400,
        costSol: 2,
      })),
      claimed: [
        { serial: 1, mint: "reward-mint", amount: 10 },
        { serial: 2, mint: "reward-mint", amount: 10 },
      ],
      now: 172_800,
    });

    assert.equal(result.costBasisUsd, 400);
    assert.equal(result.totalRewardsUsd, 50);
    assert.equal(result.rewardsOnlyRemainingUsd, 350);
    assert.equal(result.floorValueUsd, 300);
    assert.equal(result.economicPnlUsd, -50);
  });
});
