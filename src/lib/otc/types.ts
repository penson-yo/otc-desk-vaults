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
