import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  CONFIG_SEED,
  PROGRAM_ID,
  SOL_POT_SEED,
  VAULT_SEED,
} from "./constants";

export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
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

/** Token-2022 ATA owned by the vault PDA (owner is off-curve). */
export function vaultStockAta(vault: PublicKey, stockMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    stockMint,
    vault,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
}

export function otcAta(owner: PublicKey, otcMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    otcMint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
}
