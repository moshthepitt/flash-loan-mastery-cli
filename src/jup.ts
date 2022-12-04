import { BN } from "@project-serum/anchor";
import JSBI from "jsbi";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Jupiter } from "@jup-ag/core";
import {
  createAssociatedTokenAccountInstruction,
  getMint,
} from "@solana/spl-token-v2";
import {
  getTokenAccount,
  getAssociatedTokenAddressSync,
} from "flash-loan-mastery";
import { setUp, getFlashLoanInstructions } from "./flm";
import { sleep } from "./utils";

const COMMON_TOKEN_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", // RAY
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // ETH (Wormhole)
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
  amount: number
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
      slippageBps: 1,
      forceFetch: true,
    });
    const bestBuy = buyRoutesInfos[0];
    const { routesInfos: sellRoutesInfos } = await jupiter.computeRoutes({
      inputMint: mint2,
      outputMint: mint1,
      amount: buyRoutesInfos[0]?.outAmount || JSBI.BigInt(0),
      slippageBps: 1,
      forceFetch: true,
    });
    const bestSell = sellRoutesInfos[0];
    const outAmount = bestSell?.outAmount || JSBI.BigInt(0);

    let msg = "no joy";
    if (
      new BN(JSBI.toNumber(outAmount)).gt(loanRepayAmount) &&
      bestBuy &&
      bestSell
    ) {
      msg = "hit!";
      const { transactions: buyTransactions } = await jupiter.exchange({
        routeInfo: bestBuy,
      });
      const { transactions: sellTransactions } = await jupiter.exchange({
        routeInfo: bestSell,
      });

      const setUpTx = new Transaction();
      const cleanUpTx = new Transaction();
      const moneyTx = new Transaction();
      // setup flash loan
      if (flashLoanResult.setUpInstruction) {
        setUpTx.add(flashLoanResult.setUpInstruction);
      }
      // setup jupiter buy
      if (buyTransactions.setupTransaction) {
        setUpTx.add(...buyTransactions.setupTransaction.instructions);
      }
      // setup jupiter sell
      if (sellTransactions.setupTransaction) {
        setUpTx.add(...sellTransactions.setupTransaction.instructions);
      }
      if (
        flashLoanResult.setUpInstruction ||
        buyTransactions.setupTransaction ||
        sellTransactions.setupTransaction
      ) {
        console.log(
          "Set-up Transaction signature",
          await provider.sendAndConfirm(setUpTx, [wallet])
        );
      }
      // flash loan borrow
      moneyTx.add(flashLoanResult.borrow);
      // jupiter buy
      moneyTx.add(...buyTransactions.swapTransaction.instructions);
      // jupiter sell
      moneyTx.add(...sellTransactions.swapTransaction.instructions);
      // repay flash loan
      moneyTx.add(flashLoanResult.repay);
      // send tx
      console.log(
        "Arb Transaction signature",
        await provider.sendAndConfirm(moneyTx, [wallet])
      );
      // clean up jupiter buy
      if (buyTransactions.cleanupTransaction) {
        cleanUpTx.add(...buyTransactions.cleanupTransaction.instructions);
      }
      // clean up jupiter sell
      if (sellTransactions.cleanupTransaction) {
        cleanUpTx.add(...sellTransactions.cleanupTransaction.instructions);
      }
      if (
        buyTransactions.cleanupTransaction ||
        sellTransactions.cleanupTransaction
      ) {
        console.log(
          "Clean-up Transaction signature",
          await provider.sendAndConfirm(cleanUpTx, [wallet])
        );
      }
    }
    console.log(
      msg,
      (JSBI.toNumber(outAmount) - loanRepayAmount.toNumber()) /
        10 ** mint1Account.decimals,
      Date.now()
    );
    sleep(1000);
  }
};
