# OTC Desk Vaults

Dashboard for [OTC Desks](https://otcdesks.cash) on Solana.

- Combined **$OTC** token balance
- Desks (Metaplex Core NFTs) and whether they are activated
- Per-desk **vault** stock (held + credited but not yet swept)
- **Estimated APR**, labeled as derived — OTC Desks does not publish a rate

Protocol docs: [otcdesks.cash/docs](https://otcdesks.cash/docs) · X [@OTCDesks](https://x.com/OTCDesks)

## Run locally

No secrets. Public Solana RPC is the default.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127). Add a wallet by address (with an optional name) or connect. The list is stored in this browser (`localStorage`) and mirrored in the URL (`?address=…&label=…`).

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

`SOLANA_RPC_URL` is the server-side chain reader (config, vault PDAs, token accounts, Core assets). `NEXT_PUBLIC_SOLANA_RPC_URL` is the wallet-adapter RPC endpoint.

The public endpoint rate-limits. This app retries `https://solana-rpc.publicnode.com` when the Solana Foundation URL fails. A free Helius / Triton / publicnode URL via `SOLANA_RPC_URL` is still better; **DAS is not required**. Desks are found with `getProgramAccounts` on Metaplex Core, filtered by owner + collection.

Spot prices come from [Dexscreener](https://api.dexscreener.com) (token pairs) with CoinGecko as a SOL fallback. If a ticker has no price, it is omitted from USD totals and called out in the yield panel.

## How yield is calculated

OTC Desks does **not** publish APR. The dashboard derives a historical simple rate from public stats:

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

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · shadcn/ui · `@solana/web3.js`

MIT licensed ([LICENSE](./LICENSE)).
