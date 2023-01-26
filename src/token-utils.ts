import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  getTokenAccount,
  getAssociatedTokenAddressSync,
} from "flash-loan-mastery";
import { setUp } from "./flm";

const COMMON_TOKEN_MINTS = new Set([
  NATIVE_MINT.toBase58(), // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", // RAY
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // ETH (Wormhole)
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
]);

export const createTokenAccounts = async (
  connection: Connection,
  wallet: Keypair,
  mints: Set<string> = COMMON_TOKEN_MINTS,
  targetOwner: PublicKey | undefined = undefined
) => {
  const { provider } = setUp(connection, wallet);
  const owner = targetOwner || wallet.publicKey;
  const instructionPromises = Array.from(mints).map(async (it) => {
    const mintKey = new PublicKey(it);
    const ata = getAssociatedTokenAddressSync(mintKey, owner)[0];
    const possibleAcc = await getTokenAccount(connection, owner, mintKey);
    if (possibleAcc == null) {
      return createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        ata,
        owner,
        mintKey
      );
    }
    return;
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

export const wrapNative = async (
  connection: Connection,
  wallet: Keypair,
  nativeTokenAccount: PublicKey,
  amount: number
) => {
  const { provider } = setUp(connection, wallet);
  const instructions = [
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: nativeTokenAccount,
      lamports: amount * LAMPORTS_PER_SOL,
    }),
    createSyncNativeInstruction(nativeTokenAccount, TOKEN_PROGRAM_ID),
  ];
  const tx = new Transaction().add(...instructions);
  const txId = await provider.sendAndConfirm(tx, []);
  console.log("Transaction signature", txId);
};

export const unwrapNative = async (
  connection: Connection,
  wallet: Keypair,
  nativeTokenAccount: PublicKey,
  keepAccountOpen = true
) => {
  const { provider } = setUp(connection, wallet);
  const instructions = [
    createCloseAccountInstruction(
      nativeTokenAccount,
      wallet.publicKey,
      wallet.publicKey,
      [],
      TOKEN_PROGRAM_ID
    ),
  ];
  if (keepAccountOpen) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        nativeTokenAccount,
        wallet.publicKey,
        NATIVE_MINT
      )
    );
  }
  const tx = new Transaction().add(...instructions);
  const txId = await provider.sendAndConfirm(tx, []);
  console.log("Transaction signature", txId);
};
