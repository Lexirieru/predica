import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import bs58 from "bs58";

const RPC_URL = "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

function getBackendKeypair(): Keypair {
  const key = process.env.SOLANA_PRIVATE_KEY;
  if (!key) throw new Error("SOLANA_PRIVATE_KEY not set");
  return Keypair.fromSecretKey(bs58.decode(key));
}

function getUsdpMint(): PublicKey {
  const mint = process.env.USDP_MINT;
  if (!mint) throw new Error("USDP_MINT not set");
  return new PublicKey(mint);
}

// Verify a USDP deposit: check if a tx transferred USDP to backend wallet
export async function verifyDeposit(txSignature: string, expectedAmount: number, fromWallet: string): Promise<boolean> {
  try {
    const tx = await connection.getParsedTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) return false;

    const backendAddress = getBackendKeypair().publicKey.toBase58();
    const mint = getUsdpMint().toBase58();

    // Check token balance changes
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];

    for (const post of postBalances) {
      if (
        post.mint === mint &&
        post.owner === backendAddress
      ) {
        // Find matching pre-balance
        const pre = preBalances.find(
          (p) => p.accountIndex === post.accountIndex
        );
        const preAmount = parseFloat(pre?.uiTokenAmount?.uiAmountString || "0");
        const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || "0");
        const received = postAmount - preAmount;

        if (received >= expectedAmount * 0.99) {
          return true;
        }
      }
    }

    return false;
  } catch (err) {
    console.error("[Solana] verifyDeposit error:", err);
    return false;
  }
}

// Send USDP from backend wallet to user (withdraw)
export async function sendUsdp(toAddress: string, amount: number): Promise<string> {
  const keypair = getBackendKeypair();
  const mint = getUsdpMint();
  const destination = new PublicKey(toAddress);

  // Get or create token accounts
  const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, keypair, mint, keypair.publicKey
  );

  const toTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, keypair, mint, destination
  );

  // Amount in smallest unit (6 decimals)
  const amountLamports = BigInt(Math.round(amount * 1_000_000));

  const sig = await transfer(
    connection,
    keypair,
    fromTokenAccount.address,
    toTokenAccount.address,
    keypair,
    amountLamports
  );

  return sig;
}

// Get backend wallet's USDP balance
export async function getBackendUsdpBalance(): Promise<number> {
  try {
    const keypair = getBackendKeypair();
    const mint = getUsdpMint();

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection, keypair, mint, keypair.publicKey
    );

    const balance = await connection.getTokenAccountBalance(tokenAccount.address);
    return parseFloat(balance.value.uiAmountString || "0");
  } catch {
    return 0;
  }
}
