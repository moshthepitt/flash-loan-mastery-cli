import { BN } from "@project-serum/anchor";
import JSBI from "jsbi";
import {
  AccountMeta,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { Jupiter, RouteInfo } from "@jup-ag/core";
import { getMint } from "@solana/spl-token-v2";
import { setUp, getFlashLoanInstructions } from "./flm";
import {
  addKeysToLookupTable,
  chunkArray,
  createLookupTable,
  getLookupTableCacheName,
  loadCache,
  removeDuplicateKeys,
  saveCache,
  sendTransactionV0WithLookupTable,
  sleep,
} from "./utils";
import {
  MAX_INSTRUCTIONS,
  SIMPLE_ARB_CREATE_ALT_SLEEP_TIME,
  DEVNET,
  MAINNET,
  RPC_ENDPOINT,
  SIMPLE_ARB_DEFAULT_SLIPPAGE_BPS,
  SIMPLE_ARB_SLEEP_TIME,
} from "./constants";

const JUP_SEED_AMOUNT = 0.1;
const JUP_SEED_ROUNDS = 5;
const JUP_TAKE_ROUTES = 10;
const JUP_SEED_SLEEP_TIME = 1000 * 60 * 10; /** ten minutes */
const DEFAULT_KEYS_CACHE = { keys: {} };

const getJupKeysCacheName = (mint1: PublicKey, mint2: PublicKey) => {
  const env = RPC_ENDPOINT.includes(DEVNET) ? DEVNET : MAINNET;
  return `${env}-jupKeyCache-${mint1.toBase58()}-${mint2.toBase58()}.json`;
};

interface JupSeedCache {
  addressLookupTable?: string;
  keys: { [key: string]: number };
}

const loadAddressLookupTable = async (
  connection: Connection,
  key: PublicKey
) => {
  const accInfo = await connection.getAccountInfo(key, "confirmed");
  if (!accInfo) {
    throw new Error("Address lookup table does not exist");
  }
  return AddressLookupTableAccount.deserialize(accInfo.data);
};

export const seedJupArbAccountKeys = async (
  connection: Connection,
  wallet: Keypair,
  mint1: PublicKey,
  mint2: PublicKey,
  seedRounds = JUP_SEED_ROUNDS,
  sleepTime = JUP_SEED_SLEEP_TIME,
  amount = JUP_SEED_AMOUNT,
  slippageBps = SIMPLE_ARB_DEFAULT_SLIPPAGE_BPS,
  takeRoutes = JUP_TAKE_ROUTES
) => {
  const jupiter = await Jupiter.load({
    connection,
    cluster: "mainnet-beta",
    user: wallet,
    restrictIntermediateTokens: false, // We after absolute best price
    wrapUnwrapSOL: false,
  });

  const mint1Account = await getMint(connection, mint1);
  const initialAmount = amount * 10 ** mint1Account.decimals;

  const flashLoanResult = await getFlashLoanInstructions(
    connection,
    wallet,
    mint1,
    amount
  );

  const keyMetas: AccountMeta[] = [];
  // setup flash loan
  if (flashLoanResult.setUpInstruction) {
    keyMetas.push(...flashLoanResult.setUpInstruction.keys.map((it) => it));
  }
  // flash loan borrow
  keyMetas.push(...flashLoanResult.borrow.keys.map((it) => it));
  // repay flash loan
  keyMetas.push(...flashLoanResult.repay.keys.map((it) => it));

  let counter = 0;
  while (seedRounds > counter) {
    const _routeMap = jupiter.getRouteMap();
    const { routesInfos: buyRoutesInfos } = await jupiter.computeRoutes({
      inputMint: mint1,
      outputMint: mint2,
      amount: JSBI.BigInt(initialAmount),
      slippageBps,
      forceFetch: true,
    });
    const { routesInfos: sellRoutesInfos } = await jupiter.computeRoutes({
      inputMint: mint2,
      outputMint: mint1,
      amount: JSBI.BigInt(initialAmount),
      slippageBps,
      forceFetch: true,
    });

    const allRouteInfos: RouteInfo[] = buyRoutesInfos.slice(0, takeRoutes);
    allRouteInfos.push(...sellRoutesInfos.slice(0, takeRoutes));

    for (let index = 0; index < allRouteInfos.length; index++) {
      const routeInfo = allRouteInfos[index];
      if (routeInfo) {
        const { transactions: swapTransactions } = await jupiter.exchange({
          routeInfo,
        });

        // setup jupiter
        if (swapTransactions.setupTransaction) {
          keyMetas.push(
            ...swapTransactions.setupTransaction.instructions
              .map((it) => it.keys)
              .flat()
          );
        }
        // jupiter swap
        keyMetas.push(
          ...swapTransactions.swapTransaction.instructions
            .map((it) => it.keys)
            .flat()
        );
        // clean up jupiter buy
        if (swapTransactions.cleanupTransaction) {
          keyMetas.push(
            ...swapTransactions.cleanupTransaction.instructions
              .map((it) => it.keys)
              .flat()
          );
        }
      }
    }

    counter += 1;
    sleep(sleepTime);
    console.log(`Round ${counter} done.`);
  }

  const results: JupSeedCache = DEFAULT_KEYS_CACHE;
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

  const keysCacheName = getJupKeysCacheName(mint1, mint2);
  const cachedKeyResults = loadCache<JupSeedCache>(
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

export const createAddressLookupTableFromCache = async (
  connection: Connection,
  wallet: Keypair,
  mint1: PublicKey,
  mint2: PublicKey
) => {
  const { provider } = setUp(connection, wallet);
  const keysCacheName = getJupKeysCacheName(mint1, mint2);
  const cachedKeys = loadCache<JupSeedCache>(keysCacheName, DEFAULT_KEYS_CACHE);
  let addressLookupTable: PublicKey | undefined = cachedKeys.addressLookupTable
    ? new PublicKey(cachedKeys.addressLookupTable)
    : undefined;
  if (cachedKeys && addressLookupTable == null) {
    const { lookUpTable } = await createLookupTable(
      provider,
      wallet,
      true,
      SIMPLE_ARB_CREATE_ALT_SLEEP_TIME
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

export const jupiterSimpleArbWithCache = async (
  connection: Connection,
  wallet: Keypair,
  mint1: PublicKey,
  mint2: PublicKey,
  amount: number,
  slippageBps = 1
) => {
  const keysCacheName = getJupKeysCacheName(mint1, mint2);
  const cachedKeys = loadCache<JupSeedCache>(keysCacheName, DEFAULT_KEYS_CACHE);
  if (!cachedKeys || !cachedKeys.addressLookupTable) {
    throw new Error("Address lookup table is missing");
  }
  const addressLookupTable = new PublicKey(cachedKeys.addressLookupTable);
  const { provider } = setUp(connection, wallet);
  const jupiter = await Jupiter.load({
    connection,
    cluster: "mainnet-beta",
    user: wallet,
    restrictIntermediateTokens: false, // We after absolute best price
    wrapUnwrapSOL: false,
  });

  const mint1Account = await getMint(connection, mint1);
  const lookupTableData = await loadAddressLookupTable(
    connection,
    addressLookupTable
  );
  const initialAmount = amount * 10 ** mint1Account.decimals;

  const flashLoanResult = await getFlashLoanInstructions(
    connection,
    wallet,
    mint1,
    amount
  );
  const loanRepayAmount = flashLoanResult.repaymentAmount;

  while (true) {
    const _routeMap = jupiter.getRouteMap();
    const { routesInfos: buyRoutesInfos } = await jupiter.computeRoutes({
      inputMint: mint1,
      outputMint: mint2,
      amount: JSBI.BigInt(initialAmount),
      slippageBps,
      forceFetch: true,
    });
    const bestBuy = buyRoutesInfos[0];
    const { routesInfos: sellRoutesInfos } = await jupiter.computeRoutes({
      inputMint: mint2,
      outputMint: mint1,
      amount: bestBuy?.outAmount || JSBI.BigInt(0),
      slippageBps,
      forceFetch: true,
    });
    const bestSell = sellRoutesInfos[0];
    const outAmount = bestSell?.outAmount || JSBI.BigInt(0);

    if (
      new BN(JSBI.toNumber(outAmount)).gt(loanRepayAmount) &&
      bestBuy &&
      bestSell
    ) {
      const { transactions: buyTransactions } = await jupiter.exchange({
        routeInfo: bestBuy,
      });
      const { transactions: sellTransactions } = await jupiter.exchange({
        routeInfo: bestSell,
      });

      let computeIxDone = false;
      const ixs: TransactionInstruction[] = [];

      // setup jupiter buy
      if (buyTransactions.setupTransaction) {
        ixs.push(...buyTransactions.setupTransaction.instructions);
      }
      // setup flash loan
      if (flashLoanResult.setUpInstruction) {
        ixs.push(flashLoanResult.setUpInstruction);
      }
      // flash loan borrow
      ixs.push(flashLoanResult.borrow);
      // jupiter buy
      const computeIx = buyTransactions.swapTransaction.instructions[0];
      if (
        computeIx &&
        computeIx.programId.equals(ComputeBudgetProgram.programId)
      ) {
        ixs.unshift(computeIx);
        computeIxDone = true;
        ixs.push(...buyTransactions.swapTransaction.instructions.slice(1));
      } else {
        ixs.push(...buyTransactions.swapTransaction.instructions);
      }
      // setup jupiter sell
      if (sellTransactions.setupTransaction) {
        ixs.push(...sellTransactions.setupTransaction.instructions);
      }
      // jupiter sell
      const computeIx2 = sellTransactions.swapTransaction.instructions[0];
      if (
        computeIx2 &&
        computeIx2.programId.equals(ComputeBudgetProgram.programId)
      ) {
        if (!computeIxDone) {
          ixs.unshift(computeIx2);
        }
        ixs.push(...sellTransactions.swapTransaction.instructions.slice(1));
      } else {
        ixs.push(...sellTransactions.swapTransaction.instructions);
      }
      // repay flash loan
      ixs.push(flashLoanResult.repay);
      // clean up jupiter buy
      if (buyTransactions.cleanupTransaction) {
        ixs.push(...buyTransactions.cleanupTransaction.instructions);
      }
      // clean up jupiter sell
      if (sellTransactions.cleanupTransaction) {
        ixs.push(...sellTransactions.cleanupTransaction.instructions);
      }

      // check if all keys in cache
      const keysInInstructions = removeDuplicateKeys(
        ixs.map((it) => it.keys.map((meta) => meta.pubkey)).flat()
      ).map((key) => key.toBase58());
      const keysInCache = lookupTableData.addresses.map((it) => it.toBase58());
      const missingKeys = keysInInstructions.filter(
        (val) => !keysInCache.includes(val)
      );
      if (missingKeys.length > 0) {
        console.log(`${missingKeys.length} keys not cached`);
        let updateNeeded = false;
        for (let index = 0; index < missingKeys.length; index++) {
          const missingKey = missingKeys[index];
          if (missingKey) {
            if (cachedKeys.keys[missingKey] == null) {
              cachedKeys.keys[missingKey] = 1;
              if (!updateNeeded) {
                updateNeeded = true;
              }
            }
          }
        }
        if (updateNeeded) {
          saveCache(keysCacheName, cachedKeys);
          console.log(`Lookup table saved to ${keysCacheName}`);
        } else {
          console.log(`Lookup table update not needed`);
        }
      }

      // send transaction
      try {
        const txId = await sendTransactionV0WithLookupTable(
          provider,
          wallet,
          addressLookupTable,
          ixs
        );
        console.log("Transaction signature", txId);
      } catch (err) {
        console.log("Transaction failed");
        console.log(err);
      }
    }
    sleep(SIMPLE_ARB_SLEEP_TIME);
  }
};
