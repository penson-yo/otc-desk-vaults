"use client";

import { useEffect, useMemo, useState } from "react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { CLIENT_RPC } from "@/lib/otc/constants";
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  const [mobile, setMobile] = useState<Adapter[]>([]);

  useEffect(() => {
    let cancelled = false;
    void import("@solana-mobile/wallet-adapter-mobile").then((mod) => {
      if (cancelled || typeof window === "undefined") return;
      setMobile([
        new mod.SolanaMobileWalletAdapter({
          addressSelector: mod.createDefaultAddressSelector(),
          appIdentity: {
            name: "OTC Desk Vaults",
            uri: window.location.origin,
          },
          authorizationResultCache: mod.createDefaultAuthorizationResultCache(),
          cluster: "mainnet-beta",
          onWalletNotFound: mod.createDefaultWalletNotFoundHandler(),
        }),
      ]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), ...mobile],
    [mobile],
  );

  return (
    <ConnectionProvider endpoint={CLIENT_RPC}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
