import { web3 } from "@project-serum/anchor";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { setUp, getFlashLoanInstructions } from "./flm";
import {
  addKeysToLookupTable,
  createLookupTable,
  printAddressLookupTable,
  sendTransactionV0,
  sendTransactionV0WithLookupTable,
  sleep,
} from "./utils";

export const exampleFlashLoan = async (
  connection: web3.Connection,
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

export const exampleFlashLoanWithLookupTable = async (
  connection: web3.Connection,
  wallet: Keypair,
  mint: PublicKey,
  amount: number,
  referralWallet?: PublicKey
) => {
  const { provider } = setUp(connection, wallet);
  const { lookUpTable } = await createLookupTable(provider, wallet);
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

  const keys = keyMetas.map((it) => it.pubkey);
  await addKeysToLookupTable(provider, wallet, lookUpTable, keys);

  const txId = await sendTransactionV0WithLookupTable(
    provider,
    wallet,
    lookUpTable,
    ixs
  );
  console.log("Transaction signature", txId);
};
