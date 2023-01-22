import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { setUp, getFlashLoanInstructions } from "./flm";
import {
  getLookupTableCacheName,
  loadCache,
  saveCache,
  sendTransactionV0WithLookupTable,
} from "./utils";
import {
  createAddressLookupTableFromCache,
  DEFAULT_KEYS_CACHE,
  LookupTableKeysCache,
} from "./lookup_tables";
import { DEVNET, MAINNET, RPC_ENDPOINT } from "./constants";

const getExampleFlashLoanCacheName = (mint: PublicKey) => {
  const env = RPC_ENDPOINT.includes(DEVNET) ? DEVNET : MAINNET;
  return `${env}-exampleFLMCache-${mint.toBase58()}.json`;
};

export const exampleFlashLoan = async (
  connection: Connection,
  wallet: Keypair,
  mint: PublicKey,
  amount: number,
  referralWallet?: PublicKey
) => {
  const { provider } = setUp(connection, wallet);
  const result = await getFlashLoanInstructions(
    connection,
    wallet,
    mint,
    amount,
    referralWallet
  );

  const tx = new Transaction();
  if (result.setUpInstruction) {
    tx.add(result.setUpInstruction);
  }
  tx.add(result.borrow).add(result.repay);
  const txId = await provider.sendAndConfirm(tx, []);

  console.log("Transaction signature", txId);
};

export const seedExampleFlashLoanKeys = async (
  connection: Connection,
  wallet: Keypair,
  mint: PublicKey,
  amount: number,
  referralWallet?: PublicKey
) => {
  const result = await getFlashLoanInstructions(
    connection,
    wallet,
    mint,
    amount,
    referralWallet
  );

  const keyMetas = [...result.borrow.keys].concat(result.repay.keys);
  const ixs = [result.borrow, result.repay];
  if (result.setUpInstruction) {
    keyMetas.concat(result.setUpInstruction.keys);
    ixs.unshift(result.setUpInstruction);
  }

  const results: LookupTableKeysCache = DEFAULT_KEYS_CACHE;
  for (let index = 0; index < keyMetas.length; index++) {
    const keyMeta = keyMetas[index];
    if (keyMeta) {
      const keyStr = keyMeta.pubkey.toBase58();
      if (results.keys[keyStr] == null) {
        results.keys[keyStr] = 1;
      } else {
        results.keys[keyStr] += 1;
      }
    }
  }

  const keysCacheName = getExampleFlashLoanCacheName(mint);
  const cachedKeyResults = loadCache<LookupTableKeysCache>(
    keysCacheName,
    DEFAULT_KEYS_CACHE
  );
  if (cachedKeyResults && cachedKeyResults.addressLookupTable) {
    const lookupTableCacheName = getLookupTableCacheName();
    const savedLookTables = loadCache<string[]>(lookupTableCacheName, []);
    if (!savedLookTables.includes(cachedKeyResults.addressLookupTable)) {
      savedLookTables.push(cachedKeyResults.addressLookupTable);
      saveCache(lookupTableCacheName, savedLookTables);
    }
  }

  saveCache(keysCacheName, results);
  console.log(`Done. Results saved to ${keysCacheName}`);
};

export const createExampleFlashLoanAddressLookupTableFromCache = (
  connection: Connection,
  wallet: Keypair,
  mint: PublicKey
) => {
  const keysCacheName = getExampleFlashLoanCacheName(mint);
  const cachedKeyResults = loadCache<LookupTableKeysCache>(
    keysCacheName,
    DEFAULT_KEYS_CACHE
  );

  createAddressLookupTableFromCache(
    connection,
    wallet,
    keysCacheName,
    cachedKeyResults
  );
};

export const exampleFlashLoanWithLookupTable = async (
  connection: Connection,
  wallet: Keypair,
  mint: PublicKey,
  amount: number,
  referralWallet?: PublicKey
) => {
  const keysCacheName = getExampleFlashLoanCacheName(mint);
  const cachedKeys = loadCache<LookupTableKeysCache>(
    keysCacheName,
    DEFAULT_KEYS_CACHE
  );
  if (!cachedKeys || !cachedKeys.addressLookupTable) {
    throw new Error("Address lookup table is missing");
  }
  const lookUpTable = new PublicKey(cachedKeys.addressLookupTable);
  const { provider } = setUp(connection, wallet);
  const result = await getFlashLoanInstructions(
    connection,
    wallet,
    mint,
    amount,
    referralWallet
  );

  const ixs = [result.borrow, result.repay];
  if (result.setUpInstruction) {
    ixs.unshift(result.setUpInstruction);
  }
  const txId = await sendTransactionV0WithLookupTable(
    provider,
    wallet,
    lookUpTable,
    ixs
  );
  console.log("Transaction signature", txId);
};
