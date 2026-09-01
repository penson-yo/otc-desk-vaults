export type WatchWallet = {
  address: string;
  label: string;
};

export type SlotHolding = {
  index: number;
  mint: string;
  symbol: string;
  company: string;
  decimals: number;
  held: number;
  owed: number;
  usd: number;
  open: boolean;
  priceUsd: number | null;
};

export type DeskHolding = {
  asset: string;
  vault: string;
  serial: number;
  name: string;
  owner: string;
  activated: boolean;
  openMask: number;
  mintedAt: number;
  depositOtc: number;
  heldUsd: number;
  owedUsd: number;
  slots: SlotHolding[];
};

export type WalletBreakdown = {
  address: string;
  label: string;
  otc: number;
  otcUsd: number;
  desks: number;
  liveDesks: number;
  vaultUsd: number;
  owedUsd: number;
};

export type YieldEstimate = {
  status: "ok" | "unavailable";
  reason: string | null;
  formula: string;
  paidToHoldersUsd: number | null;
  usdPerLiveDesk: number | null;
  yearsElapsed: number | null;
  firstMintAt: number | null;
  mintCostUsd: number | null;
  apr: number | null;
  apy: number | null;
  derived: true;
};

export type ProtocolSnapshot = {
  program: string;
  config: string;
  pot: string;
  collection: string;
  tokenMint: string;
  protocolWallet: string;
  minted: number;
  holders: number;
  maxSupply: number;
  potSol: number;
  roundThresholdSol: number;
  nextTicker: string;
  lastRoundAt: number;
  minRoundInterval: number;
  depositRequired: number;
  surchargeSol: number;
  otcBurned: number | null;
  paidToHoldersUsd: number | null;
  otcPriceUsd: number | null;
  otcMarketCapUsd: number | null;
  nftFloorSol: number | null;
  nftFloorUsd: number | null;
};

export type MarketSnapshot = {
  fetchedAt: number;
  otcMint: string | null;
  otcPriceUsd: number | null;
  otcMarketCapUsd: number | null;
  nftFloorSol: number | null;
  nftFloorUsd: number | null;
  listedCount: number | null;
  collectionSymbol: string;
};

export type ClaimedReward = {
  mint: string;
  symbol: string;
  amount: number;
  usd: number;
  realizedUsd: number;
  unsoldUsd: number;
};

export type DeskBreakEven = {
  wallet: string;
  asset: string;
  vault: string;
  serial: number;
  purchasedAt: number;
  costSol: number;
  costUsd: number;
  floorUsd: number | null;
  realizedRewardsUsd: number;
  unsoldClaimedRewardsUsd: number;
  claimedRewardsUsd: number;
  unclaimedRewardsUsd: number;
  totalRewardsUsd: number;
  economicPnlUsd: number | null;
  bestBidSol: number | null;
  bestBidNetSol: number | null;
  bestBidExpiresAt: number | null;
  assignedExitNetSol: number | null;
  rewards: ClaimedReward[];
};

export type BreakEvenResponse = {
  fetchedAt: number;
  status: "ok" | "partial" | "unavailable";
  basisDesks: number;
  currentDesks: number;
  costBasisSol: number;
  costBasisUsd: number;
  floorValueSol: number | null;
  floorValueUsd: number | null;
  instantExitSol: number | null;
  instantExitUsd: number | null;
  instantExitEconomicPnlUsd: number | null;
  instantExitDesks: number;
  realizedRewardsUsd: number;
  unsoldClaimedRewardsUsd: number;
  claimedRewardsUsd: number;
  unclaimedRewardsUsd: number;
  totalRewardsUsd: number;
  economicPnlUsd: number | null;
  rewardsOnlyRemainingUsd: number;
  dailyRewardsUsd: number | null;
  rewardsOnlyEtaDays: number | null;
  deskDays: number;
  desks: DeskBreakEven[];
  warnings: string[];
  methodology: string;
};

export type PortfolioResponse = {
  fetchedAt: number;
  rpc: string;
  protocol: ProtocolSnapshot;
  prices: Record<string, number>;
  yield: YieldEstimate;
  wallets: WalletBreakdown[];
  desks: DeskHolding[];
  totals: {
    otc: number;
    otcUsd: number;
    desks: number;
    liveDesks: number;
    vaultUsd: number;
    owedUsd: number;
    estimatedAnnualUsd: number | null;
  };
  warnings: string[];
};
