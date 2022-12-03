import { PublicKey, Commitment } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

export const RPC_ENDPOINT =
  process.env.RPC_URI || "https://api.devnet.solana.com";
const FLM_PROGRAM_ID_STR =
  process.env.FLM_PROGRAM_ID || "1oanfPPN8r1i4UbugXHDxWMbWVJ5qLSN5qzNFZkz6Fg";

export const FLM_PROGRAM_ID = new PublicKey(FLM_PROGRAM_ID_STR);
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const USDT_MINT = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);
export const SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

export const confirmTransactionInitialTimeout =
    60 * 1000; /** time to allow for the server to initially process a transaction (in milliseconds) */
export const providerOptions = {
  preflightCommitment: 'confirmed' as Commitment,
  commitment: 'confirmed' as Commitment,
};
