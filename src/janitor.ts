import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { setUp } from "./flm";
import { getAssociatedTokenAddressSync } from "flash-loan-mastery";

export const getPoolAccounts = async (
  connection: Connection,
  wallet: Keypair
) => {
  const { program } = setUp(connection, wallet);
  const pools = await program.account.poolAuthority.all();
  const finalPools = pools.map((it) => {
    const bankToken = getAssociatedTokenAddressSync(
      it.account.mint,
      it.publicKey
    );
    return {
      poolMint: it.account.mint.toBase58(),
      poolShareMint: it.account.poolShareMint.toBase58(),
      poolBank: bankToken[0].toBase58(),
      poolBankAmount: 0,
    };
  });
  const tokenAccounts = await connection.getMultipleParsedAccounts(
    finalPools.map((it) => new PublicKey(it.poolBank)),
    { commitment: "confirmed" }
  );
  for (let index = 0; index < finalPools.length; index++) {
    const thisPool = finalPools[index];
    const thisToken = tokenAccounts.value[index];

    if (thisPool && thisToken) {
      const balance = (thisToken.data as any).parsed.info.tokenAmount
        .uiAmount as number;
      thisPool.poolBankAmount = balance;
    }
  }
  console.table(finalPools);
};
