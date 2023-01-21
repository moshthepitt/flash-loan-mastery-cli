import { BN } from "@project-serum/anchor";
import JSBI from "jsbi";
import {
  AccountMeta,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { Jupiter } from "@jup-ag/core";
import {
  createAssociatedTokenAccountInstruction,
  getMint,
} from "@solana/spl-token/";
import {
  getTokenAccount,
  getAssociatedTokenAddressSync,
} from "flash-loan-mastery";
import { setUp, getFlashLoanInstructions } from "./flm";
import {
  addKeysToLookupTable,
  chunkArray,
  createLookupTable,
  printAddressLookupTable,
  removeDuplicateKeys,
  sendTransactionV0WithLookupTable,
  sleep,
} from "./utils";
import {
  MAX_INSTRUCTIONS,
  SIMPLE_ARB_CREATE_ALT_SLEEP_TIME,
  SIMPLE_ARB_SLEEP_TIME,
} from "./constants";

const COMMON_TOKEN_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", // RAY
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // ETH (Wormhole)
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
]);

export const createCommonTokenAccounts = async (
  connection: Connection,
  wallet: Keypair,
  mints: Set<string> = COMMON_TOKEN_MINTS
) => {
  const { provider } = setUp(connection, wallet);
  const instructionPromises = Array.from(mints).map(async (it) => {
    const mintKey = new PublicKey(it);
    const ata = getAssociatedTokenAddressSync(mintKey, wallet.publicKey)[0];
    const possibleAcc = await getTokenAccount(
      connection,
      wallet.publicKey,
      mintKey
    );
    if (possibleAcc == null) {
      return createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        ata,
        wallet.publicKey,
        mintKey
      );
    }
  });
  const instructions = await Promise.all(instructionPromises);
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

/** Doesn't work because of transaction size limits */
export const jupiterSimpleArb = async (
  connection: Connection,
  wallet: Keypair,
  mint1: PublicKey,
  mint2: PublicKey,
  amount: number,
  slippageBps = 1
) => {
  const { provider } = setUp(connection, wallet);
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
      const { lookUpTable } = await createLookupTable(
        provider,
        wallet,
        true,
        SIMPLE_ARB_CREATE_ALT_SLEEP_TIME
      );
      const { transactions: buyTransactions } = await jupiter.exchange({
        routeInfo: bestBuy,
      });
      const { transactions: sellTransactions } = await jupiter.exchange({
        routeInfo: bestSell,
      });

      const keyMetas: AccountMeta[] = [];
      let computeIxDone = false;
      const ixs = [];

      // setup jupiter buy
      if (buyTransactions.setupTransaction) {
        ixs.push(...buyTransactions.setupTransaction.instructions);
        keyMetas.push(
          ...buyTransactions.setupTransaction.instructions
            .map((it) => it.keys)
            .flat()
        );
      }
      // setup flash loan
      if (flashLoanResult.setUpInstruction) {
        ixs.push(flashLoanResult.setUpInstruction);
        keyMetas.push(...flashLoanResult.setUpInstruction.keys.map((it) => it));
      }
      // flash loan borrow
      ixs.push(flashLoanResult.borrow);
      keyMetas.push(...flashLoanResult.borrow.keys.map((it) => it));
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
      keyMetas.push(
        ...buyTransactions.swapTransaction.instructions
          .map((it) => it.keys)
          .flat()
      );
      // setup jupiter sell
      if (sellTransactions.setupTransaction) {
        ixs.push(...sellTransactions.setupTransaction.instructions);
        keyMetas.push(
          ...sellTransactions.setupTransaction.instructions
            .map((it) => it.keys)
            .flat()
        );
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
      keyMetas.push(
        ...sellTransactions.swapTransaction.instructions
          .map((it) => it.keys)
          .flat()
      );
      // repay flash loan
      ixs.push(flashLoanResult.repay);
      keyMetas.push(...flashLoanResult.repay.keys.map((it) => it));
      // clean up jupiter buy
      if (buyTransactions.cleanupTransaction) {
        ixs.push(...buyTransactions.cleanupTransaction.instructions);
        keyMetas.push(
          ...buyTransactions.cleanupTransaction.instructions
            .map((it) => it.keys)
            .flat()
        );
      }
      // clean up jupiter sell
      if (sellTransactions.cleanupTransaction) {
        ixs.push(...sellTransactions.cleanupTransaction.instructions);
        keyMetas.push(
          ...sellTransactions.cleanupTransaction.instructions
            .map((it) => it.keys)
            .flat()
        );
      }
      // add keys to lookup table
      const keys = removeDuplicateKeys(keyMetas.map((it) => it.pubkey));
      if (keys.length > MAX_INSTRUCTIONS) {
        const chunkedKeys = chunkArray(keys, MAX_INSTRUCTIONS);
        await Promise.all(
          chunkedKeys.map((it) =>
            addKeysToLookupTable(provider, wallet, lookUpTable, it, false)
          )
        );
        await printAddressLookupTable(provider.connection, lookUpTable, false);
      } else {
        await addKeysToLookupTable(provider, wallet, lookUpTable, keys);
      }
      // send transaction
      try {
        const txId = await sendTransactionV0WithLookupTable(
          provider,
          wallet,
          lookUpTable,
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
