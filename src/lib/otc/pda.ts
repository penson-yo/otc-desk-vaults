import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  CONFIG_EXT_SEED,
  CONFIG_SEED,
  PROGRAM_ID,
  SOL_POT_SEED,
  VAULT_EXT_SEED,
  VAULT_SEED,
} from "./constants";

export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
}

export function configExtPda(): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_EXT_SEED], PROGRAM_ID)[0];
}

export function solPotPda(): PublicKey {
  return PublicKey.findProgramAddressSync([SOL_POT_SEED], PROGRAM_ID)[0];
}

export function vaultPda(asset: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, asset.toBuffer()],
    PROGRAM_ID,
  )[0];
}

/** Extended per-desk ticker state PDA seeds: ["vault_ext", vault]. */
export function vaultExtPda(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_EXT_SEED, vault.toBuffer()],
    PROGRAM_ID,
  )[0];
}

/** Token-2022 ATA of any owner (vault/config PDAs set allowOwnerOffCurve). */
export function token2022Ata(
  owner: PublicKey,
  mint: PublicKey,
  allowOwnerOffCurve = false,
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    TOKEN_2022_PROGRAM_ID,
  );
}

/** Token-2022 ATA owned by the vault PDA (owner is off-curve). */
export function vaultStockAta(vault: PublicKey, stockMint: PublicKey): PublicKey {
  return token2022Ata(vault, stockMint, true);
}

/** Token-2022 ATA owned by the config PDA — the shared distribute/sweep pool. */
export function poolStockAta(config: PublicKey, stockMint: PublicKey): PublicKey {
  return token2022Ata(config, stockMint, true);
}

export function otcAta(owner: PublicKey, otcMint: PublicKey): PublicKey {
  return token2022Ata(owner, otcMint, false);
}

export function userStockAta(owner: PublicKey, stockMint: PublicKey): PublicKey {
  return token2022Ata(owner, stockMint, false);
}
