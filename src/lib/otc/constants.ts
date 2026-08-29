import { PublicKey } from "@solana/web3.js";

/** On-chain program (docs: otcdesks.cash/docs § The accounts). */
export const PROGRAM_ID = new PublicKey(
  "AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW",
);

export const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
);

export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

/** Config PDA seeds: ["config"] */
export const CONFIG_SEED = Buffer.from("config");
/** Pot PDA seeds: ["sol_pot"] */
export const SOL_POT_SEED = Buffer.from("sol_pot");
/** Vault PDA seeds: ["vault", asset] */
export const VAULT_SEED = Buffer.from("vault");

export const CONFIG_DISCRIMINATOR = Buffer.from([
  155, 12, 170, 224, 30, 250, 204, 130,
]);
export const VAULT_DISCRIMINATOR = Buffer.from([
  211, 8, 232, 43, 2, 152, 117, 119,
]);

/** counter/stamp scale used by settle/distribute. */
export const PRECISION = 1_000_000_000_000n;

export const OTC_DECIMALS = 6;
export const TICKER_COUNT = 10;
export const MAX_SUPPLY = 5_000;

export const PUBLIC_RPC =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

/** Tried in order when SOLANA_RPC_URL is unset (public mainnet is often busy). */
export const RPC_CANDIDATES = process.env.SOLANA_RPC_URL
  ? [process.env.SOLANA_RPC_URL]
  : [
      "https://api.mainnet-beta.solana.com",
      "https://solana-rpc.publicnode.com",
    ];

export const CLIENT_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

export type StockMeta = {
  mint: string;
  symbol: string;
  company: string;
  decimals: number;
};

/** Metadata keyed by mint. Slot order is read from Config.stock_mints. */
export const STOCKS: Record<string, StockMeta> = {
  XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp: {
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    symbol: "AAPLx",
    company: "Apple",
    decimals: 8,
  },
  XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX: {
    mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    symbol: "MSFTx",
    company: "Microsoft",
    decimals: 8,
  },
  Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh: {
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    symbol: "NVDAx",
    company: "NVIDIA",
    decimals: 8,
  },
  Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg: {
    mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    symbol: "AMZNx",
    company: "Amazon",
    decimals: 8,
  },
  XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1: {
    mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    symbol: "CRCLx",
    company: "Circle",
    decimals: 8,
  },
  Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8: {
    mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
    symbol: "SPCXx",
    company: "SpaceX",
    decimals: 8,
  },
  Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw: {
    mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    symbol: "ANTHROPIC",
    company: "Anthropic",
    decimals: 9,
  },
  Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP: {
    mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP",
    symbol: "POLYMARKET",
    company: "Polymarket",
    decimals: 9,
  },
  PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua: {
    mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua",
    symbol: "KALSHI",
    company: "Kalshi",
    decimals: 9,
  },
  PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S: {
    mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S",
    symbol: "NEURALINK",
    company: "Neuralink",
    decimals: 9,
  },
};

export function stockMeta(mint: string): StockMeta {
  return (
    STOCKS[mint] ?? {
      mint,
      symbol: `${mint.slice(0, 4)}…`,
      company: "Unknown ticker",
      decimals: 8,
    }
  );
}

export const DEFAULT_WATCH_WALLETS = [
  {
    address: "ALthNNeegniQz1XUeKzu1ej5P4FJEodXqmpugfgPVAHS",
    label: "Seeker",
  },
  {
    address: "6ChksV4svsK7KUE26uNugS44q47g6sQFCq5qVyogXxkp",
    label: "Fomo Sol",
  },
] as const;

export const WATCH_STORAGE_KEY = "otc-vaults-watch";
export const THEME_STORAGE_KEY = "theme";
