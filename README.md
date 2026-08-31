# OTC Desk Vaults

Dashboard for [OTC Desks](https://otcdesks.cash) on Solana.

- Combined **$OTC** token balance
- Desks (Metaplex Core NFTs) and whether they are activated
- Per-desk **vault** stock (held + credited but not yet swept)
- **Estimated APR**, labeled as derived — OTC Desks does not publish a rate
- **Break-even** from Magic Eden cost basis, claimed rewards, floor, and live bid depth

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

Reads use `https://solana-rpc.publicnode.com` (then the Solana Foundation URL) unless you set `SOLANA_RPC_URL`. Wallet claims go through same-origin `/api/rpc` so the browser is not 403'd by `api.mainnet-beta.solana.com`.

```
SOLANA_RPC_URL=https://your-solana-rpc.example
```

`SOLANA_RPC_URL` is the server-side chain reader (config, vault PDAs, token accounts, Core assets) and the `/api/rpc` proxy. Set `NEXT_PUBLIC_SOLANA_RPC_URL` only if you want the wallet adapter to skip the proxy.

The public endpoints rate-limit. A free Helius / Triton / publicnode URL via `SOLANA_RPC_URL` is still better; **DAS is not required**. Desks are found with `getProgramAccounts` on Metaplex Core, filtered by owner + collection.

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

## Break-even and exit values

For desks currently held by a watched wallet, the dashboard matches the latest
Magic Eden `buyNow` activity for cost basis. It scans post-purchase Solana token
transfers from each desk vault to the buyer, values those claimed rewards at
current spot prices, and adds stock still held or owed in the vault.

Two exit views are deliberately separate:

- **Floor exit** — every desk valued at the live collection floor. This is a
  patient-sale estimate, not an executable quote.
- **Exit now** — live Magic Eden MMM `buyPriceTaker` offers allocated across
  unique pool capacity. One pool bid is never multiplied across every desk.

The rewards-only ETA extrapolates the wallet's current-marked reward value since
each purchase. It is historical run-rate math, not a forecast. Claimed token
value, floor value, and SOL-denominated cost basis all move with spot prices.

Per-desk links open the asset on Magic Eden. The app does not construct an
automatic NFT sale: Magic Eden instruction endpoints require authenticated,
marketplace-supported transaction builders, and no Core NFT sell builder has
been verified for these desks. Claiming and selling therefore remain separate,
wallet-approved actions.

## On-chain layout

Program `AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW` (`otcdesks` 0.1.0).

| Account | PDA seeds |
| --- | --- |
| Config | `["config"]` |
| Extended ticker registry | `["config_ext"]` |
| SOL pot | `["sol_pot"]` |
| Vault | `["vault", asset]` |
| Extended vault state | `["vault_ext", vault]` |
| Stock in a vault | Token-2022 ATA of the vault (associated token program) |

The first ten ticker slots live in Config / Vault. Ticker 11 onward lives in
ConfigExt / VaultExt; the current eleventh ticker is `$OTC`. `$OTC` mint is
`Config.token_mint` (pump.fun Token-2022). Collection is `Config.collection`.

This repo decodes the program accounts directly rather than scraping private
HTTP APIs.

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · shadcn/ui · `@solana/web3.js`

MIT licensed ([LICENSE](./LICENSE)).
