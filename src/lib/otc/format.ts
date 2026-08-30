export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function fmtNum(
  value: number,
  opts: { max?: number; min?: number } = {},
): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: opts.max ?? 2,
    minimumFractionDigits: opts.min ?? 0,
  });
}

export function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: abs >= 1 ? Math.min(2, digits) : 0,
  });
}

export function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  const digits = Math.abs(pct) >= 100 ? 0 : 1;
  return `${pct.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}%`;
}

export function fmtOtc(value: number): string {
  return `${fmtNum(value, { max: 2 })} OTC`;
}

export function fmtSol(lamportsOrSol: number, fromLamports = false): string {
  const sol = fromLamports ? lamportsOrSol / 1e9 : lamportsOrSol;
  return `${fmtNum(sol, { max: 4 })} SOL`;
}

export function fmtTime(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function uiAmount(raw: bigint, decimals: number): number {
  if (raw === 0n) return 0;
  const den = 10n ** BigInt(decimals);
  const whole = Number(raw / den);
  const frac = Number(raw % den) / Number(den);
  return whole + frac;
}

/** Best-effort UI → raw. Prefer on-chain amounts for swaps. */
export function uiToRaw(ui: number, decimals: number): bigint {
  if (!Number.isFinite(ui) || ui <= 0) return 0n;
  const den = 10n ** BigInt(decimals);
  const scaled = ui * Number(den);
  if (!Number.isFinite(scaled)) return 0n;
  const raw = BigInt(Math.round(scaled));
  return raw < 0n ? 0n : raw;
}

export function solscanAccount(address: string): string {
  return `https://solscan.io/account/${address}`;
}

export function solscanToken(address: string): string {
  return `https://solscan.io/token/${address}`;
}

export function magicEdenItem(address: string): string {
  return `https://magiceden.io/item-details/${address}`;
}

export function explorerCollection(address: string): string {
  return `https://core.metaplex.com/explorer/collection/${address}`;
}
