# OTC Desk Vaults

A public, **read-only** dashboard for [OTC Desks](https://otcdesks.cash) on Solana. Paste one or more wallets (or optionally connect Phantom / Solana Mobile / Seeker) and inspect:

- Combined **$OTC** token balance
- Desks (Metaplex Core NFTs) and whether they are activated
- Per-desk **vault** stock (held + credited but not yet swept)
- **Estimated APR / APY**, labeled as derived — OTC Desks does not publish a rate

This app **cannot drain wallets**. It never asks for a private key, never builds transfer / swap / approve / mint instructions, and optional wallet-adapter connect only reads a public address (the wallet may still show its own connect message).

Protocol docs: [otcdesks.cash/docs](https://otcdesks.cash/docs) · X [@OTCDesks](https://x.com/OTCDesks)

## Run locally

No secrets. Public Solana RPC is the default.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127). The view defaults to two watch-only addresses:

| Label | Address | What it holds (at time of writing) |
| --- | --- | --- |
| Seeker | `ALthNNeegniQz1XUeKzu1ej5P4FJEodXqmpugfgPVAHS` | OTC Desk NFTs |
| Fomo Sol | `6ChksV4svsK7KUE26uNugS44q47g6sQFCq5qVyogXxkp` | `$OTC` |

Paste more addresses, add/remove wallets, or connect a wallet — the combined totals row is the point. The list is stored in `localStorage` and mirrored in the URL (`?address=…&address=…`) so you can share a view.

```bash
npm run build
npm start -- --port 43127
```

### RPC

Reads use `https://api.mainnet-beta.solana.com` unless you set:

```
SOLANA_RPC_URL=https://your-solana-rpc.example
NEXT_PUBLIC_SOLANA_RPC_URL=https://your-solana-rpc.example
```

`SOLANA_RPC_URL` is the server-side chain reader (config, vault PDAs, token accounts, Core assets). `NEXT_PUBLIC_SOLANA_RPC_URL` is only for the wallet-adapter connection object — still read-only.

The public endpoint rate-limits. This app retries `https://solana-rpc.publicnode.com` when the Solana Foundation URL fails. A free Helius / Triton / publicnode URL via `SOLANA_RPC_URL` is still better; **DAS is not required**. Desks are found with `getProgramAccounts` on Metaplex Core, filtered by owner + collection.

The home page loads the default watch wallets on the server so the first HTML already includes desks and $OTC — not a blank skeleton.

Spot prices come from [Dexscreener](https://api.dexscreener.com) (token pairs) with CoinGecko as a SOL fallback. If a ticker has no price, it is omitted from USD totals and called out in the yield panel.

## How yield is calculated

OTC Desks does **not** publish APR or APY. The dashboard derives a historical rate from public stats:

1. **Paid to holders (USD)**  
   `Σ acquired[i] / 10^decimals[i] × spotPriceUsd[i]`  
   `acquired[i]` is the Config account’s lifetime base units of stock `i` bought in rounds.

2. **USD per live desk**  
   `paidToHoldersUsd / holders`  
   Rounds split equally across live desks (`holders` on Config).

3. **Years elapsed**  
   `(now − earliest vault minted_at) / 365.25 days`  
   First mint is the minimum `minted_at` across vault accounts.

4. **Mint cost (USD)**  
   `deposit_required` (burned OTC, currently 100,000) × OTC price **+** `surcharge` (0.5 SOL) × SOL price.

5. **APR** (simple)  
   `(usdPerLiveDesk / yearsElapsed) / mintCostUsd`

6. **APY**  
   `(1 + APR/365)^365 − 1`  
   Daily compounding of that same simple rate. **Omitted** when the sample is shorter than ~30 days or APR is extreme — compounding a two-day mint window is not a yield.

If no stock has been acquired, there are no live desks, prices are missing, or the protocol is less than a day old, the UI says **cannot compute yet** and why.

Forward-looking fill (mint surcharge, Magic Eden royalties, pump.fun creator fees) is **not** projected. The pot is not a promise.

Per-desk vault contents:

- **Held** — Token-2022 ATA of the vault PDA for each ticker
- **Owed** — `(counter[i] − stamp[i]) / PRECISION` with `PRECISION = 10^12`  
  Credited by rounds, delivered later by `distribute` / `sweep`

Unactivated desks still accrue `owed` from mint, but rounds skip paying the ATA until ticker accounts are opened.

## On-chain layout (from the program IDL)

Program `AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW` (`otcdesks` 0.1.0).

| Account | PDA seeds |
| --- | --- |
| Config | `["config"]` |
| SOL pot | `["sol_pot"]` |
| Vault | `["vault", asset]` |
| Stock in a vault | Token-2022 ATA of the vault (associated token program) |

`$OTC` mint is `Config.token_mint` (pump.fun Token-2022). Collection is `Config.collection`.

The IDL is published on-chain (Anchor). This repo decodes Config / Vault from that spec rather than scraping private HTTP APIs.

## Security

- MIT license ([LICENSE](./LICENSE))
- No custody, no seed phrases, no server-side wallets
- Optional connect is `@solana/wallet-adapter` with `autoConnect={false}`
- Grep the repo for `sendTransaction`, `signTransaction`, `SystemProgram.transfer` — they are not used by this UI
- You can paste addresses only; connect is never required

If a site claiming to be this dashboard asks you to sign a transfer, it is not this app.

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · shadcn/ui · `@solana/web3.js`
