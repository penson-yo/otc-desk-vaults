import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not put @solana/web3.js in serverExternalPackages. Vercel then
  // require()s CJS rpc-websockets, which cannot load ESM-only uuid
  // (ERR_REQUIRE_ESM → production 500 "This page couldn’t load").
  // Preview and local browsers often hit 127.0.0.1 while Next binds localhost.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "http://127.0.0.1:43127",
    "http://localhost:43127",
  ],
};

export default nextConfig;
