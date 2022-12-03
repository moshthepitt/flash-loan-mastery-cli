import { web3 } from "@project-serum/anchor";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { setUp, getFlashLoanInstructions } from "./flm";

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
