import {
  AddressLookupTableAccount,
  AddressLookupTableState,
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { MAX_ACCOUNTS_TO_FETCH, MAX_ACCOUNTS_TO_PROCESS } from "./constants";
import { setUp } from "./flm";
import { chunkArray, loadCache, saveCache } from "./utils";

export interface AddressLookupTableResult {
  key: PublicKey;
  account: AddressLookupTableState;
}

export const getAddressLookupTables = async (
  connection: Connection,
  cacheName: string
) => {
  const savedLookTables = loadCache<string[]>(cacheName, []);
  const tableAccountInfos = (
    await Promise.all(
      chunkArray(
        savedLookTables.map((addr) => new PublicKey(addr)),
        MAX_ACCOUNTS_TO_FETCH
      ).map((chunk) => connection.getMultipleAccountsInfo(chunk))
    )
  ).flat();

  const results: AddressLookupTableResult[] = [];
  for (let index = 0; index < tableAccountInfos.length; index++) {
    const altInfo = tableAccountInfos[index];
    const altAddress = savedLookTables[index];
    if (altInfo && altAddress) {
      const addressLookupTable = AddressLookupTableAccount.deserialize(
        altInfo.data
      );
      results.push({
        key: new PublicKey(altAddress),
        account: addressLookupTable,
      });
    }
  }

  return results;
};

export const extractJupAccountKeys = async (
  connection: Connection,
  cacheName: string
) => {
  const tables = await getAddressLookupTables(connection, cacheName);
  const keys: PublicKey[] = [];
  for (let index = 0; index < tables.length; index++) {
    const element = tables[index];
    if (element) {
      keys.push(...element.account.addresses);
    }
  }

  const results: { [key: string]: number } = {};
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key) {
      const keyStr = key.toBase58();
      if (results[keyStr] == null) {
        results[keyStr] = 1;
      } else {
        results[keyStr] += 1;
      }
    }
  }

  const newCacheName = cacheName.includes(".")
    ? `${cacheName.split(".")[0]}-keys.json`
    : `${cacheName}-keys.json`;

  saveCache(newCacheName, results);
  return results;
};

export const deactivateLookupTables = async (
  connection: Connection,
  wallet: Keypair,
  cacheName: string
) => {
  const { provider } = setUp(connection, wallet);
  const tables = await getAddressLookupTables(connection, cacheName);
  console.log("Total number of tables", tables.length);
  const instructions = tables.map((it) =>
    AddressLookupTableProgram.deactivateLookupTable({
      lookupTable: it.key,
      authority: wallet.publicKey,
    })
  );
  const chunks = chunkArray(instructions, MAX_ACCOUNTS_TO_PROCESS);
  for (let index = 0; index < chunks.length; index++) {
    const element = chunks[index];
    if (element) {
      const tx = new Transaction().add(...element);
      try {
        const txId = await provider.sendAndConfirm(tx, []);
        console.log(`Deactivated ${element.length} tables`);
        console.log("Transaction signature", txId);
      } catch {
        console.log(`Failed to deactivate ${element.length} tables`);
      }
    }
  }
};

export const closeLookupTables = async (
  connection: Connection,
  wallet: Keypair,
  cacheName: string
) => {
  const { provider } = setUp(connection, wallet);
  const tables = await getAddressLookupTables(connection, cacheName);
  const currentSlot = await connection.getSlot("confirmed");
  console.log("currentSlot", currentSlot);
  const validTables = tables.filter((table) => {
    return currentSlot > Number(table.account.deactivationSlot);
  });
  console.log("Total number of tables", tables.length);
  console.log("Number of tables that can be closed", validTables.length);
  if (validTables.length > 0) {
    const savedLookTables = loadCache<string[]>(cacheName, []);
    const chunks = chunkArray(validTables, MAX_ACCOUNTS_TO_PROCESS);
    for (let index = 0; index < chunks.length; index++) {
      const element = chunks[index];
      if (element) {
        const instructions = element.map((it) =>
          AddressLookupTableProgram.closeLookupTable({
            lookupTable: it.key,
            authority: wallet.publicKey,
            recipient: wallet.publicKey,
          })
        );
        const tx = new Transaction().add(...instructions);
        let successful = true;
        try {
          const txId = await provider.sendAndConfirm(tx, []);
          console.log(`Closed ${element.length} tables`);
          console.log("Transaction signature", txId);
        } catch (e) {
          console.log(`Failed to close ${element.length} tables`, e);
          successful = false;
        }
        if (successful) {
          const updatedLookTables = savedLookTables.filter(
            (it) => !element.map((el) => el.key.toBase58()).includes(it)
          );
          saveCache(cacheName, updatedLookTables);
        }
      }
    }
  }
};
