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
  SIMPLE_ARB_DEFAULT_SLIPPAGE_BPS,
} from "./constants";
import { exampleFlashLoan, exampleFlashLoanWithLookupTable } from "./examples";
import {
  depositIntoFlashLoanPool,
  initFlashLoanPool,
  withdrawFromFlashLoanPool,
} from "./flm";
import { closeLookupTables, deactivateLookupTables } from "./janitor";
import { createCommonTokenAccounts, jupiterSimpleArb } from "./jup";
import { loadKeypair, sleep } from "./utils";
import {
  seedJupArbAccountKeys,
  createAddressLookupTableFromCache,
  jupiterSimpleArbWithCache,
} from "./premium";

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

program
  .command("example-flash-loan-with-lookup-table")
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
    "Execute an example of a flash loan instruction using Solana v0 transactions - borrow and immediately repay"
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
  .command("create-token-accounts")
  .requiredOption("-k, --keypair <keypair>")
  .addHelpText(
    "beforeAll",
    "Create common token accounts based to reduce setup when trading or to setup platform fee accounts"
  )
  .action(async ({ keypair }) => {
    await createCommonTokenAccounts(CONNECTION, loadKeypair(keypair));
  });

program
  .command("simple-jupiter-arb")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-m1, --token-mint1 <PublicKey>")
  .requiredOption("-m2, --token-mint2 <PublicKey>")
  .requiredOption("-a, --amount <number>", "The amount")
  .option("-s, --slippageBps <number>", "The max slippage Bps")
  .addHelpText("beforeAll", "Perform a simple arb using Jupiter")
  .action(async ({ keypair, tokenMint1, tokenMint2, amount, slippageBps }) => {
    let count = 0;
    while (count < MAX_DIE_RETRIES) {
      count += 1;
      try {
        await jupiterSimpleArb(
          CONNECTION,
          loadKeypair(keypair),
          new PublicKey(tokenMint1),
          new PublicKey(tokenMint2),
          Number(amount),
          slippageBps == null
            ? SIMPLE_ARB_DEFAULT_SLIPPAGE_BPS
            : Number(slippageBps)
        );
      } catch (err) {
        console.log("retry simple-jupiter-arb");
        if (count === MAX_DIE_RETRIES) {
          throw err;
        }
        sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
      }
    }
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

program
  .command("seed-jupiter-arb-keys")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-m1, --token-mint1 <PublicKey>")
  .requiredOption("-m2, --token-mint2 <PublicKey>")
  .option("-a, --amount <number>", "The amount")
  .option("-r, --seedRounds <number>", "The number of rounds")
  .option(
    "-l, --sleepTime <number>",
    "The amount of time to sleep between rounds"
  )
  .option("-s, --slippageBps <number>", "The max slippage Bps")
  .option("-t, --takeRoutes <number>", "The number of routes to sample")
  .addHelpText("beforeAll", "Create a cache of accounts used for Jupiter arbs")
  .action(
    async ({
      keypair,
      tokenMint1,
      tokenMint2,
      amount,
      seedRounds,
      sleepTime,
      slippageBps,
      takeRoutes,
    }) => {
      let count = 0;
      while (count < MAX_DIE_RETRIES) {
        count += 1;
        try {
          await seedJupArbAccountKeys(
            CONNECTION,
            loadKeypair(keypair),
            new PublicKey(tokenMint1),
            new PublicKey(tokenMint2),
            seedRounds == null ? undefined : Number(seedRounds),
            sleepTime == null ? undefined : Number(sleepTime),
            amount == null ? undefined : Number(amount),
            slippageBps == null ? undefined : Number(slippageBps),
            takeRoutes == null ? undefined : Number(takeRoutes)
          );
          break;
        } catch (err) {
          console.log("retry seed-jupiter-arb-keys");
          if (count === MAX_DIE_RETRIES) {
            throw err;
          }
          sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
        }
      }
    }
  );

program
  .command("create-lookup-table-from-cache")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-m1, --token-mint1 <PublicKey>")
  .requiredOption("-m2, --token-mint2 <PublicKey>")
  .addHelpText(
    "beforeAll",
    "Create an address lookup table from a cache of accounts used for Jupiter arbs"
  )
  .action(async ({ keypair, tokenMint1, tokenMint2 }) => {
    let count = 0;
    while (count < MAX_DIE_RETRIES) {
      count += 1;
      try {
        await createAddressLookupTableFromCache(
          CONNECTION,
          loadKeypair(keypair),
          new PublicKey(tokenMint1),
          new PublicKey(tokenMint2)
        );
        break;
      } catch (err) {
        console.log("retry create-lookup-table-from-cache");
        if (count === MAX_DIE_RETRIES) {
          throw err;
        }
        sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
      }
    }
  });

program
  .command("cached-jupiter-arb")
  .requiredOption("-k, --keypair <keypair>")
  .requiredOption("-m1, --token-mint1 <PublicKey>")
  .requiredOption("-m2, --token-mint2 <PublicKey>")
  .requiredOption("-a, --amount <number>", "The amount")
  .option("-s, --slippageBps <number>", "The max slippage Bps")
  .addHelpText("beforeAll", "Perform a simple cached arb using Jupiter")
  .action(async ({ keypair, tokenMint1, tokenMint2, amount, slippageBps }) => {
    let count = 0;
    while (count < MAX_DIE_RETRIES) {
      count += 1;
      try {
        await jupiterSimpleArbWithCache(
          CONNECTION,
          loadKeypair(keypair),
          new PublicKey(tokenMint1),
          new PublicKey(tokenMint2),
          Number(amount),
          slippageBps == null
            ? SIMPLE_ARB_DEFAULT_SLIPPAGE_BPS
            : Number(slippageBps)
        );
      } catch (err) {
        console.log("retry cached-jupiter-arb");
        if (count === MAX_DIE_RETRIES) {
          throw err;
        }
        sleep(DIE_SLEEP_TIME * MAX_DIE_RETRIES);
      }
    }
  });

program.parse();
