import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import {
  getTokenAccount,
  getAssociatedTokenAddressSync,
} from "flash-loan-mastery";
import { setUp } from "./flm";

const COMMON_TOKEN_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", // RAY
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // ETH (Wormhole)
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
]);

export const createCommonTokenAccounts = async (
  connection: Connection,
  wallet: Keypair,
  mints: Set<string> = COMMON_TOKEN_MINTS
) => {
  const { provider } = setUp(connection, wallet);
  const instructionPromises = Array.from(mints).map(async (it) => {
    const mintKey = new PublicKey(it);
    const ata = getAssociatedTokenAddressSync(mintKey, wallet.publicKey)[0];
    const possibleAcc = await getTokenAccount(
      connection,
      wallet.publicKey,
      mintKey
    );
    if (possibleAcc == null) {
      return createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        ata,
        wallet.publicKey,
        mintKey
      );
    }
  });
  const instructions = await (
    await Promise.all(instructionPromises)
  ).filter((it) => it != null);
  let counter = 0;
  if (instructions.length > 0) {
    const tx = new Transaction();
    instructions.forEach((it) => {
      if (it) {
        tx.add(it);
        counter += 1;
      }
    });
    if (counter > 0) {
      const txId = await provider.sendAndConfirm(tx, []);
      console.log("Num of accounts created", counter);
      console.log("Transaction signature", txId);
    }
  } else {
    console.log("No accounts to be created");
  }
};
