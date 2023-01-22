import { Connection, PublicKey } from "@solana/web3.js";
import { Command } from "commander";
import {
  RPC_ENDPOINT,
  USDC_MINT,
  USDT_MINT,
  SOL_MINT,
  MAX_DIE_RETRIES,
  confirmTransactionInitialTimeout,
  providerOptions,
  DIE_SLEEP_TIME,
} from "./constants";
import {
  createExampleFlashLoanAddressLookupTableFromCache,
  exampleFlashLoan,
  exampleFlashLoanWithLookupTable,
  seedExampleFlashLoanKeys,
} from "./examples";
import {
  depositIntoFlashLoanPool,
  initFlashLoanPool,
  withdrawFromFlashLoanPool,
} from "./flm";
import { closeLookupTables, deactivateLookupTables } from "./lookup_tables";
import { createCommonTokenAccounts } from "./token-utils";
import { loadKeypair, sleep } from "./utils";


const CONNECTION = new Connection(RPC_ENDPOINT, {
  commitment: providerOptions.commitment,
  confirmTransactionInitialTimeout,
});

const program = new Command();

program
  .command("create-token-accounts")
  .requiredOption("-k, --keypair <keypair>")
  .addHelpText(
    "beforeAll",
    "Create common token accounts based to reduce setup when running other commands"
  )
  .action(async ({ keypair }) => {
    await createCommonTokenAccounts(CONNECTION, loadKeypair(keypair));
  });

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

program
  .command("seed-example-flash-loan-lookup-table")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-tm, --token-mint <PublicKey>")
  .requiredOption("-a, --amount <number>", "The amount")
  .addHelpText(
    "beforeAll",
    "Create a cache of accounts used for example flash loan transactions"
  )
  .action(async ({ keypair, tokenMint, amount }) => {
    let count = 0;
    while (count < MAX_DIE_RETRIES) {
      count += 1;
      try {
        await seedExampleFlashLoanKeys(
          CONNECTION,
          loadKeypair(keypair),
          new PublicKey(tokenMint),
          Number(amount)
        );
        break;
      } catch (err) {
        console.log("retry seed-example-flash-loan-lookup-table");
        if (count === MAX_DIE_RETRIES) {
          throw err;
        }
        sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
      }
    }
  });

program
  .command("create-versioned-flash-loan-lookup-table-from-cache")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-tm, --token-mint <PublicKey>")
  .addHelpText(
    "beforeAll",
    "Create an address lookup table from a cache of accounts used for example flash loans"
  )
  .action(async ({ keypair, tokenMint }) => {
    let count = 0;
    while (count < MAX_DIE_RETRIES) {
      count += 1;
      try {
        await createExampleFlashLoanAddressLookupTableFromCache(
          CONNECTION,
          loadKeypair(keypair),
          new PublicKey(tokenMint)
        );
        break;
      } catch (err) {
        console.log(
          "retry create-versioned-flash-loan-lookup-table-from-cache"
        );
        if (count === MAX_DIE_RETRIES) {
          throw err;
        }
        sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
      }
    }
  });

program
  .command("example-versioned-flash-loan")
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
    "Execute an example of a flash loan instruction using Solana v0 versioned transactions - borrow and immediately repay"
  )
  .action(async ({ keypair, tokenMint, amount, referralWallet }) => {
    await exampleFlashLoanWithLookupTable(
      CONNECTION,
      loadKeypair(keypair),
      new PublicKey(tokenMint),
      Number(amount),
      referralWallet ? new PublicKey(referralWallet) : undefined
    );
  });

program
  .command("deactivate-lookup-tables")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-c, --cache-file <keypair>")
  .addHelpText("beforeAll", "TODO")
  .action(async ({ keypair, cacheFile }) => {
    deactivateLookupTables(CONNECTION, loadKeypair(keypair), cacheFile);
  });

program
  .command("close-lookup-tables")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-c, --cache-file <keypair>")
  .addHelpText("beforeAll", "TODO")
  .action(async ({ keypair, cacheFile }) => {
    closeLookupTables(CONNECTION, loadKeypair(keypair), cacheFile);
  });

program.parse();
