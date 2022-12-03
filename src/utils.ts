import { Keypair } from "@solana/web3.js";
import fs from "fs";

export function loadKeypair(keypairPath: string): Keypair {
  const loaded = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );

  return loaded;
}
