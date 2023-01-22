import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { setUp } from "./flm";
import {
  addKeysToLookupTable,
  chunkArray,
  createLookupTable,
  saveCache,
} from "./utils";
import { MAX_INSTRUCTIONS, CREATE_ALT_SLEEP_TIME, MAX_IX_RETRIES } from "./constants";

export const DEFAULT_KEYS_CACHE = { keys: {} };

export interface LookupTableKeysCache {
  addressLookupTable?: string;
  keys: { [key: string]: number };
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
