import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@solana/web3.js", "bs58"],
  // Preview and local browsers often hit 127.0.0.1 while Next binds localhost.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "http://127.0.0.1:43127",
    "http://localhost:43127",
  ],
};

export default nextConfig;
