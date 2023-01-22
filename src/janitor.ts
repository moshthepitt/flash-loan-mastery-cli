import { Connection, PublicKey } from "@solana/web3.js";
import { saveCache } from "./utils";
import { getAddressLookupTables } from "./lookup_tables";

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
