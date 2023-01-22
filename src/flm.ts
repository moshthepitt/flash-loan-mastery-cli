import { AnchorProvider, BN, Program, Wallet } from "@project-serum/anchor";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getMint,
} from "@solana/spl-token";
import {
  deposit,
  initPool,
  flashLoan,
  FlashLoanMastery,
  getAssociatedTokenAddressSync,
  getProgram,
  getTokenAccount,
  withdraw,
} from "flash-loan-mastery";
import { FLM_PROGRAM_ID, providerOptions } from "./constants";

export const setUp = (connection: Connection, wallet: Keypair): {
  program: Program<FlashLoanMastery>;
  provider: AnchorProvider;
} => {
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    ...AnchorProvider.defaultOptions(),
    commitment: providerOptions.commitment,
    preflightCommitment: providerOptions.preflightCommitment,
  });
  const program = getProgram(FLM_PROGRAM_ID, provider);
  return { program, provider };
};

export const initFlashLoanPool = async (
  connection: Connection,
  wallet: Keypair,
  tokenMint: PublicKey,
  poolMint: PublicKey
) => {
  const { program, provider } = setUp(connection, wallet);
  const result = await initPool({
    program,
    connection,
    funder: wallet,
    tokenMint,
    poolMint,
    poolMintAuthority: wallet,
  });

  const tx = new Transaction().add(
    ...result.instructions.map((it) => it.instruction)
  );
  const txId = await provider.sendAndConfirm(
    tx,
    result.instructions.map((it) => it.signers).flat()
  );

  console.log("Pool Address", result.poolAuthority.toBase58());
  console.log("Pool Bank Token Address", result.bankToken.toBase58());
  console.log("Transaction signature", txId);
};

export const depositIntoFlashLoanPool = async (
  connection: Connection,
  wallet: Keypair,
  mint: PublicKey,
  tokenFrom: PublicKey,
  amount: number
) => {
  const { program, provider } = setUp(connection, wallet);

  const mintAccount = await getMint(connection, mint);

  const result = await deposit({
    program,
    connection,
    depositor: wallet.publicKey,
    mint,
    tokenFrom,
    amount: new BN(amount * 10 ** mintAccount.decimals),
  });

  const tx = new Transaction().add(
    ...result.instructions.map((it) => it.instruction)
  );
  const txId = await provider.sendAndConfirm(
    tx,
    result.instructions.map((it) => it.signers).flat()
  );
  console.log("Pool Address", result.poolAuthority.toBase58());
  console.log("Pool Bank Token Address", result.bankToken.toBase58());
  console.log("Pool Share Token Address", result.poolShareTokenTo.toBase58());
  console.log("Transaction signature", txId);
};

export const withdrawFromFlashLoanPool = async (
  connection: Connection,
  wallet: Keypair,
  mint: PublicKey,
  poolShareTokenFrom: PublicKey,
  amount: number
) => {
  const { program, provider } = setUp(connection, wallet);

  const mintAccount = await getMint(connection, mint);

  const result = await withdraw({
    program,
    connection,
    withdrawer: wallet.publicKey,
    mint,
    poolShareTokenFrom,
    amount: new BN(amount * 10 ** mintAccount.decimals),
  });

  const tx = new Transaction().add(
    ...result.instructions.map((it) => it.instruction)
  );
  const txId = await provider.sendAndConfirm(
    tx,
    result.instructions.map((it) => it.signers).flat()
  );

  console.log("Pool Address", result.poolAuthority.toBase58());
  console.log("Transaction signature", txId);
};

export const getFlashLoanInstructions = async (
  connection: Connection,
  wallet: Keypair,
  mint: PublicKey,
  amount: number,
  referralWallet?: PublicKey
): Promise<{
  setUpInstruction: TransactionInstruction | undefined;
  borrow: TransactionInstruction;
  repay: TransactionInstruction;
  repaymentAmount: BN;
}> => {
  const { program } = setUp(connection, wallet);
  const mintAccount = await getMint(connection, mint);

  let setUpIx: TransactionInstruction | undefined = undefined;
  if (referralWallet) {
    const possibleReferralTokenAccount = await getTokenAccount(
      connection,
      referralWallet,
      mint
    );
    if (possibleReferralTokenAccount == null) {
      setUpIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        getAssociatedTokenAddressSync(mint, referralWallet)[0],
        referralWallet,
        mint
      );
    }
  }

  const result = await flashLoan({
    program,
    borrower: wallet.publicKey,
    mint,
    referralTokenTo: referralWallet
      ? getAssociatedTokenAddressSync(mint, referralWallet)[0]
      : undefined,
    amount: new BN(amount * 10 ** mintAccount.decimals),
  });

  return {
    ...result,
    setUpInstruction: setUpIx,
  };
};
