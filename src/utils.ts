import { AnchorProvider } from "@project-serum/anchor";
import {
  AddressLookupTableProgram,
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

export const createLookupTable = async (
  provider: AnchorProvider,
  payer: Keypair,
  doPrint = true,
  maxRetries = 5
): Promise<{
  lookUpTable: PublicKey;
  txId: string;
}> => {
  let count = 0;
  while (count < maxRetries) {
    count += 1;
    try {
      const result = AddressLookupTableProgram.createLookupTable({
        authority: payer.publicKey,
        payer: payer.publicKey,
        recentSlot: await provider.connection.getSlot(),
      });
      const txId = await sendTransactionV0(provider, payer, [result[0]]);
      if (doPrint) {
        await printAddressLookupTable(provider.connection, result[1]);
      }
      return {
        lookUpTable: result[1],
        txId,
      };
    } catch (err) {
      console.log("retry create address lookup table");
      if (count === maxRetries) {
        throw(err);
      }
    }
  }
  throw new Error(
    `could not create address lookup table after ${maxRetries} retries`
  );
};

export const addKeysToLookupTable = async (
  provider: AnchorProvider,
  payer: Keypair,
  lookupTablePubkey: PublicKey,
  keys: PublicKey[],
  doPrint = true,
  maxRetries = 5
): Promise<string> => {
  let count = 0;
  while (count < maxRetries) {
    count += 1;
    try {
      const ix = AddressLookupTableProgram.extendLookupTable({
        addresses: removeDuplicateKeys(keys),
        authority: payer.publicKey,
        lookupTable: lookupTablePubkey,
        payer: payer.publicKey,
      });
      const txId = await sendTransactionV0(provider, payer, [ix]);
      if (doPrint) {
        await printAddressLookupTable(provider.connection, lookupTablePubkey);
      }
      return txId;
    } catch (err) {
      console.log("retry add keys to address lookup table");
      if (count === maxRetries) {
        throw(err);
      }
    }
  }
  throw new Error(
    `could not add keys to address lookup table after ${maxRetries} retries`
  );
};

export async function sendTransactionV0(
  provider: AnchorProvider,
  payer: Keypair,
  instructions: TransactionInstruction[]
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
  const txId = await provider.connection.sendTransaction(tx);
  return txId;
}

export async function sendTransactionV0WithLookupTable(
  provider: AnchorProvider,
  payer: Keypair,
  lookupTablePubkey: PublicKey,
  instructions: TransactionInstruction[]
): Promise<string> {
  const lookupTableAccount = await provider.connection
    .getAddressLookupTable(lookupTablePubkey)
    .then((res) => res.value);

  if (!lookupTableAccount) {
    throw new Error("address lookup table does not exist");
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

export async function printAddressLookupTable(
  connection: Connection,
  lookupTablePubkey: PublicKey,
  printAddresses = true
): Promise<void> {
  await sleep(1000);
  const lookupTableAccount = await connection
    .getAddressLookupTable(lookupTablePubkey)
    .then((res) => res.value);
  if (!lookupTableAccount) {
    throw new Error("address lookup table does not exist");
  }
  console.log(`Address Lookup Table: ${lookupTablePubkey}`);
  if (printAddresses) {
    for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
      const address = lookupTableAccount.state.addresses[i];
      if (address) {
        console.log(`   Index: ${i}  Address: ${address.toBase58()}`);
      }
    }
  }
}

export const removeDuplicateKeys = (keys: PublicKey[]) => {
  const strKeys = keys.map((it) => it.toBase58());
  return keys.filter(
    (it, index) => !strKeys.includes(it.toBase58(), index + 1)
  );
};

/** Break array into chunks */
export const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
  return Array.from(
    { length: Math.ceil(array.length / chunkSize) },
    (_, index) => array.slice(index * chunkSize, (index + 1) * chunkSize)
  );
};

export const findDuplicates = <T>(arr: T[]): T[] =>
  arr.filter((item, index) => arr.indexOf(item) != index);
