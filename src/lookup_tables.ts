import {
  AddressLookupTableAccount,
  AddressLookupTableState,
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { setUp } from "./flm";
import {
  addKeysToLookupTable,
  chunkArray,
  createLookupTable,
  loadCache,
  saveCache,
} from "./utils";
import { MAX_INSTRUCTIONS, MAX_ACCOUNTS_TO_FETCH, MAX_ACCOUNTS_TO_PROCESS, MAX_IX_RETRIES } from "./constants";

export const DEFAULT_KEYS_CACHE = { keys: {} };

export interface LookupTableKeysCache {
  addressLookupTable?: string;
  keys: { [key: string]: number };
}

export interface AddressLookupTableResult {
  key: PublicKey;
  account: AddressLookupTableState;
}

export const loadAddressLookupTable = async (
  connection: Connection,
  key: PublicKey
) => {
  const accInfo = await connection.getAccountInfo(key, "confirmed");
  if (!accInfo) {
    throw new Error("Address lookup table does not exist");
  }
  return AddressLookupTableAccount.deserialize(accInfo.data);
};

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

export const createAddressLookupTableFromCache = async (
  connection: Connection,
  wallet: Keypair,
  keysCacheName: string,
  cachedKeys: LookupTableKeysCache
) => {
  const { provider } = setUp(connection, wallet);
  let addressLookupTable: PublicKey | undefined = cachedKeys.addressLookupTable
    ? new PublicKey(cachedKeys.addressLookupTable)
    : undefined;
  if (cachedKeys && addressLookupTable == null) {
    const { lookUpTable } = await createLookupTable(
      provider,
      wallet,
      true,
      MAX_IX_RETRIES
    );
    addressLookupTable = lookUpTable;
    cachedKeys.addressLookupTable = lookUpTable.toBase58();
    saveCache(keysCacheName, cachedKeys);
    console.log(`Lookup table saved to ${keysCacheName}`);
  }

  if (!addressLookupTable) {
    throw new Error("Address lookup table should now be defined");
  }
  const lookupTableData = await loadAddressLookupTable(
    connection,
    addressLookupTable
  );
  const existingInTable = lookupTableData.addresses.map((it) => it.toBase58());
  let missingInTable = Object.keys(cachedKeys.keys)
    .filter((key) => !existingInTable.includes(key))
    .map((it) => new PublicKey(it));
  if (missingInTable.length > 0) {
    if (missingInTable.length > MAX_INSTRUCTIONS) {
      const chunkedKeys = chunkArray(missingInTable, MAX_INSTRUCTIONS);
      await Promise.all(
        chunkedKeys.map((it) =>
          addKeysToLookupTable(
            provider,
            wallet,
            addressLookupTable as PublicKey,
            it,
            false
          )
        )
      );
    } else {
      await addKeysToLookupTable(
        provider,
        wallet,
        addressLookupTable,
        missingInTable,
        false
      );
    }
    console.log(`Added ${missingInTable.length} to lookup table`);
  }
};
