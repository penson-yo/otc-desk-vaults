import { WSOL_MINT, stockMeta } from "./constants";
import { uiAmount } from "./format";
import type { OtcConfig } from "./decode";
import { isDefaultMint } from "./decode";
import type { YieldEstimate } from "./types";

const SECONDS_PER_YEAR = 365.25 * 24 * 3600;

export function mintCostUsd(
  config: OtcConfig,
  prices: Record<string, number>,
): number | null {
  const otcPrice = prices[config.tokenMint];
  const solPrice = prices[WSOL_MINT.toBase58()];
  if (otcPrice == null || solPrice == null) return null;
  const deposit = uiAmount(config.depositRequired, 6);
  const surchargeSol = Number(config.surcharge) / 1e9;
  return deposit * otcPrice + surchargeSol * solPrice;
}

export function paidToHoldersUsd(
  config: OtcConfig,
  prices: Record<string, number>,
): { usd: number; missing: string[] } {
  let usd = 0;
  const missing: string[] = [];
  for (let i = 0; i < config.stockMints.length; i++) {
    const mint = config.stockMints[i]!;
    if (isDefaultMint(mint)) continue;
    const meta = stockMeta(mint);
    const price = prices[mint];
    const amount = uiAmount(config.acquired[i]!, meta.decimals);
    if (price == null) {
      if (amount > 0) missing.push(meta.symbol);
      continue;
    }
    usd += amount * price;
  }
  return { usd, missing };
}

/**
 * Protocol APR/APY is not published. We annualize historical USD of
 * `acquired` stock per live desk against mint cost (burned OTC + 0.5 SOL surcharge).
 *
 * APR  = (paidUsd / holders / years) / mintCostUsd
 * APY  = (1 + APR/365)^365 − 1   (daily compounding of that simple rate)
 */
export function estimateYield(args: {
  config: OtcConfig;
  prices: Record<string, number>;
  firstMintAt: number | null;
  now: number;
}): YieldEstimate {
  const formula =
    "APR = ((Σ acquired[i] × price[i]) / live desks / years since first mint) / (OTC deposit × OTC price + 0.5 SOL). APY = (1 + APR/365)^365 − 1. Counters are on-chain; prices are spot. Not a protocol-published rate.";

  const holders = Number(args.config.holders);
  const { usd: paid, missing } = paidToHoldersUsd(args.config, args.prices);
  const cost = mintCostUsd(args.config, args.prices);
  const firstMintAt = args.firstMintAt;

  if (holders <= 0) {
    return {
      status: "unavailable",
      reason: "No live desks on-chain yet, so there is nothing to split rounds across.",
      formula,
      paidToHoldersUsd: paid || null,
      usdPerLiveDesk: null,
      yearsElapsed: null,
      firstMintAt,
      mintCostUsd: cost,
      apr: null,
      apy: null,
      derived: true,
    };
  }

  if (paid <= 0) {
    return {
      status: "unavailable",
      reason:
        missing.length > 0
          ? `Cannot price acquired stock (${missing.join(", ")}).`
          : "No stock has been acquired on-chain yet (acquired[] is still zero).",
      formula,
      paidToHoldersUsd: 0,
      usdPerLiveDesk: 0,
      yearsElapsed: null,
      firstMintAt,
      mintCostUsd: cost,
      apr: null,
      apy: null,
      derived: true,
    };
  }

  if (!firstMintAt || firstMintAt <= 0) {
    return {
      status: "unavailable",
      reason:
        "Need the earliest vault minted_at to annualize. Paid-to-holders USD is available; duration is not.",
      formula,
      paidToHoldersUsd: paid,
      usdPerLiveDesk: paid / holders,
      yearsElapsed: null,
      firstMintAt,
      mintCostUsd: cost,
      apr: null,
      apy: null,
      derived: true,
    };
  }

  const years = (args.now - firstMintAt) / SECONDS_PER_YEAR;
  const usdPerDesk = paid / holders;
  const days = years * 365.25;

  if (years < 1 / 365) {
    return {
      status: "unavailable",
      reason:
        "Protocol is less than a day old — annualizing a few hours of rounds would be noise, not a rate.",
      formula,
      paidToHoldersUsd: paid,
      usdPerLiveDesk: usdPerDesk,
      yearsElapsed: years,
      firstMintAt,
      mintCostUsd: cost,
      apr: null,
      apy: null,
      derived: true,
    };
  }

  if (cost == null || cost <= 0) {
    return {
      status: "unavailable",
      reason: "Need OTC and SOL spot prices to turn USD-per-desk into APR against mint cost.",
      formula,
      paidToHoldersUsd: paid,
      usdPerLiveDesk: usdPerDesk,
      yearsElapsed: years,
      firstMintAt,
      mintCostUsd: cost,
      apr: null,
      apy: null,
      derived: true,
    };
  }

  const annualUsd = usdPerDesk / years;
  const apr = annualUsd / cost;
  // Daily compounding of a four-digit APR from a two-day mint window is not a rate.
  const apy =
    days >= 30 && apr < 2 && apr > -1
      ? Math.pow(1 + apr / 365, 365) - 1
      : null;

  const shortWindow =
    days < 30
      ? `Annualized from ${days.toFixed(1)} days of rounds (TGE-scale minting). Treat APR as a run-rate, not a forecast. APY is omitted until the sample is ~30 days — compounding this window would be meaningless.`
      : missing.length > 0
        ? `Missing prices for ${missing.join(", ")}; those tickers are omitted from paid-to-holders.`
        : null;

  return {
    status: "ok",
    reason: shortWindow,
    formula,
    paidToHoldersUsd: paid,
    usdPerLiveDesk: usdPerDesk,
    yearsElapsed: years,
    firstMintAt,
    mintCostUsd: cost,
    apr,
    apy,
    derived: true,
  };
}
