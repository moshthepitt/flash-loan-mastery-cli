import { Connection, PublicKey } from "@solana/web3.js";
import { Command } from "commander";
import {
  RPC_ENDPOINT,
  USDC_MINT,
  USDT_MINT,
  SOL_MINT,
  confirmTransactionInitialTimeout,
  providerOptions,
} from "./constants";
import { exampleFlashLoan } from "./examples";
import {
  depositIntoFlashLoanPool,
  initFlashLoanPool,
  withdrawFromFlashLoanPool,
} from "./flm";
import { loadKeypair } from "./utils";

const CONNECTION = new Connection(RPC_ENDPOINT, {
  commitment: providerOptions.commitment,
  confirmTransactionInitialTimeout,
});

const program = new Command();

program
  .command("init-pool")
  .requiredOption(
    "-k, --keypair <Keypair path>",
    "File path to wallet that executes the transaction"
  )
  .requiredOption(
    "-tm, --token-mint <PublicKey>",
    "Mint address of the token to be borrowed using flash loans"
  )
  .requiredOption(
    "-pm, --pool-mint <PublicKey>",
    "New and empty mint address to be used for pool share tokens"
  )
  .addHelpText("beforeAll", "Initialize a flash loan mastery pool")
  .action(async ({ keypair, tokenMint, poolMint }) => {
    const mintInput = tokenMint.toLowerCase();
    const tokenMintKey =
      mintInput === "usdc"
        ? USDC_MINT
        : mintInput === "usdt"
        ? USDT_MINT
        : mintInput === "sol"
        ? SOL_MINT
        : new PublicKey(tokenMint);
    await initFlashLoanPool(
      CONNECTION,
      loadKeypair(keypair),
      tokenMintKey,
      new PublicKey(poolMint)
    );
  });

program
  .command("deposit")
  .requiredOption(
    "-k, --keypair <Keypair path>",
    "File path to wallet that executes the transaction"
  )
  .requiredOption(
    "-tm, --token-mint <PublicKey>",
    "Mint address of the token to be deposited into the flash loan pool"
  )
  .requiredOption(
    "-tf, --token-from <PublicKey>",
    "Source token account of the amount being deposited"
  )
  .requiredOption("-a, --amount <number>", "The amount")
  .addHelpText("beforeAll", "Deposit into a flash loan mastery pool")
  .action(async ({ keypair, tokenMint, tokenFrom, amount }) => {
    await depositIntoFlashLoanPool(
      CONNECTION,
      loadKeypair(keypair),
      new PublicKey(tokenMint),
      new PublicKey(tokenFrom),
      Number(amount)
    );
  });

program
  .command("withdraw")
  .requiredOption(
    "-k, --keypair <Keypair path>",
    "File path to wallet that executes the transaction"
  )
  .requiredOption(
    "-tm, --token-mint <PublicKey>",
    "Mint address of the token to be withdrawn from the flash loan pool"
  )
  .requiredOption(
    "-ptf, --pool-share-token-from <PublicKey>",
    "Source token account for the pool share tokens being redeemed"
  )
  .requiredOption("-a, --amount <number>", "The amount")
  .addHelpText("beforeAll", "Withdraw from a flash loan mastery pool")
  .action(async ({ keypair, tokenMint, poolShareTokenFrom, amount }) => {
    await withdrawFromFlashLoanPool(
      CONNECTION,
      loadKeypair(keypair),
      new PublicKey(tokenMint),
      new PublicKey(poolShareTokenFrom),
      Number(amount)
    );
  });

program
  .command("example-flash-loan")
  .requiredOption(
    "-k, --keypair <Keypair path>",
    "File path to wallet that executes the transaction"
  )
  .requiredOption(
    "-tm, --token-mint <PublicKey>",
    "Mint address of the token to be borrowed via flash loan"
  )
  .requiredOption("-a, --amount <number>", "The amount")
  .option("-r, --referral-wallet <PublicKey>", "Referral wallet")
  .addHelpText(
    "beforeAll",
    "Execute an example of a flash loan instruction - borrow and immediately repay"
  )
  .action(async ({ keypair, tokenMint, amount, referralWallet }) => {
    await exampleFlashLoan(
      CONNECTION,
      loadKeypair(keypair),
      new PublicKey(tokenMint),
      Number(amount),
      referralWallet ? new PublicKey(referralWallet) : undefined
    );
  });

program.parse();
