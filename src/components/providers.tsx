"use client";

import { Buffer } from "buffer";
import { useCallback, useState } from "react";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { CLIENT_RPC } from "@/lib/otc/constants";
import "@solana/wallet-adapter-react-ui/styles.css";
import "@/app/wallet-adapter-overrides.css";

if (typeof window !== "undefined") {
  const w = window as unknown as { Buffer?: typeof Buffer };
  if (!w.Buffer) w.Buffer = Buffer;
}

/**
 * Stable adapter list. WalletProvider also injects Wallet Standard wallets
 * (installed Phantom, Solflare, Backpack, Seeker) and Mobile Wallet Adapter
 * on phones. Recreating adapters on render disconnects the session.
 */
const WALLETS: Adapter[] = [new PhantomWalletAdapter()];

export function Providers({ children }: { children: React.ReactNode }) {
  const [walletError, setWalletError] = useState<string | null>(null);
  const onError = useCallback((error: WalletError) => {
    console.error("Wallet adapter:", error);
    setWalletError(error.message || String(error));
  }, []);

  return (
    <ConnectionProvider endpoint={CLIENT_RPC}>
      <WalletProvider
        wallets={WALLETS}
        // WalletModal only calls select(). Without this, picking a wallet
        // closes the modal and never calls adapter.connect(), so Phantom
        // never prompts.
        autoConnect
        onError={onError}
      >
        <WalletModalProvider>
          {walletError ? (
            <p className="border-b border-alert/40 bg-alert/10 px-4 py-2 text-center text-[12px] text-alert">
              {walletError}
            </p>
          ) : null}
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
