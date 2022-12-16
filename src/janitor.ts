import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { MAX_ACCOUNTS_TO_FETCH } from "./constants";
import { chunkArray, loadCache, saveCache } from "./utils";

export const extractJupAccountKeys = async (
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

  const keys: PublicKey[] = [];
  for (let index = 0; index < tableAccountInfos.length; index++) {
    const element = tableAccountInfos[index];
    if (element) {
      const addressLookupTable = AddressLookupTableAccount.deserialize(
        element.data
      );
      keys.push(...addressLookupTable.addresses);
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
