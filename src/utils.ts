import { AnchorProvider } from "@project-serum/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import fs from "fs";

export function loadKeypair(keypairPath: string): Keypair {
  const loaded = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );

  return loaded;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendTransactionV0WithoutLookupTable(
  provider: AnchorProvider,
  payer: Keypair,
  instructions: TransactionInstruction[],
): Promise<string> {
  let blockhash = await provider.connection
    .getLatestBlockhash()
    .then((res) => res.blockhash);

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([payer]);
  return await provider.connection.sendTransaction(tx);
}

export async function sendTransactionV0WithLookupTable(
  provider: AnchorProvider,
  payer: Keypair,
  lookupTablePubkey: PublicKey,
  instructions: TransactionInstruction[],
): Promise<string> {
  const lookupTableAccount = await provider.connection
    .getAddressLookupTable(lookupTablePubkey)
    .then((res) => res.value);

  if (!lookupTableAccount) {
    throw new Error("lookup table does not exist");
  }

  let blockhash = await provider.connection
    .getLatestBlockhash()
    .then((res) => res.blockhash);

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([lookupTableAccount]);

  const tx = new VersionedTransaction(messageV0);
  tx.sign([payer]);
  return await provider.connection.sendTransaction(tx);
}
