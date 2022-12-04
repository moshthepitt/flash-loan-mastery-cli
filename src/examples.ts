import { web3 } from "@project-serum/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { setUp, getFlashLoanInstructions } from "./flm";
import { sendTransactionV0WithoutLookupTable } from "./utils";

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

  const ixs = [result.borrow, result.repay];
  if (result.setUpInstruction) {
    ixs.unshift(result.setUpInstruction);
  }
  const txId = await sendTransactionV0WithoutLookupTable(provider, wallet, ixs);
  console.log("Transaction signature", txId);
};
