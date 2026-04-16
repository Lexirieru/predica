import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import bs58 from "bs58";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
export const connection = new Connection(RPC_URL, "confirmed");

function getBackendKeypair(): Keypair {
  const key = process.env.SOLANA_PRIVATE_KEY;
  if (!key) throw new Error("SOLANA_PRIVATE_KEY not set");
  try {
    return Keypair.fromSecretKey(bs58.decode(key));
  } catch (e) {
    // Hex fallback
    return Keypair.fromSecretKey(Uint8Array.from(Buffer.from(key, 'hex')));
  }
}

function getUsdpMint(): PublicKey {
  const mint = process.env.USDP_MINT;
  if (!mint) throw new Error("USDP_MINT not set");
  return new PublicKey(mint);
}

// Verify USDP deposit against the claimed sender and amount.
// Rules:
//   - tx must be confirmed and error-free
//   - mint must equal USDP
//   - backend token account balance increase == expectedAmount (within 1 micro-USDP rounding)
//   - sender token account (owned by fromWallet) balance decrease >= expectedAmount
// Retries RPC transiently (tx indexing lag) but returns false fast on hard-fails.
const DEPOSIT_EPSILON = 0.000001; // 1 micro-USDP
const MAX_RPC_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

export async function verifyDeposit(
  txSignature: string,
  expectedAmount: number,
  fromWallet: string,
  conn: any = connection
): Promise<boolean> {
  const backendAddress = getBackendKeypair().publicKey.toBase58();
  const mint = getUsdpMint().toBase58();

  for (let attempt = 1; attempt <= MAX_RPC_RETRIES; attempt++) {
    try {
      const tx = await conn.getParsedTransaction(txSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      // RPC hasn't indexed yet — retry.
      if (!tx || !tx.meta) {
        if (attempt < MAX_RPC_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        console.warn(`[Solana] Tx ${txSignature} not found after ${MAX_RPC_RETRIES} attempts`);
        return false;
      }

      // Hard reject: tx failed on-chain.
      if (tx.meta.err) {
        console.warn(`[Solana] Tx ${txSignature} failed on-chain:`, tx.meta.err);
        return false;
      }

      const pre = tx.meta.preTokenBalances || [];
      const post = tx.meta.postTokenBalances || [];

      // Backend USDP account change (must increase by expectedAmount).
      const backendDelta = computeOwnerDelta(pre, post, backendAddress, mint);
      if (Math.abs(backendDelta - expectedAmount) > DEPOSIT_EPSILON) {
        console.warn(
          `[Solana] Amount mismatch for ${txSignature}: backend delta ${backendDelta}, expected ${expectedAmount}`
        );
        return false;
      }

      // Sender USDP account change (must decrease by at least expectedAmount).
      // fromWallet is the wallet authority, not the token account.
      const senderDelta = computeOwnerDelta(pre, post, fromWallet, mint);
      if (-senderDelta < expectedAmount - DEPOSIT_EPSILON) {
        console.warn(
          `[Solana] Sender ${fromWallet} did not debit ${expectedAmount} USDP in tx ${txSignature} (delta=${senderDelta})`
        );
        return false;
      }

      console.log(`[Solana] Deposit verified: ${expectedAmount} USDP from ${fromWallet}`);
      return true;
    } catch (err) {
      console.error(`[Solana] verifyDeposit error (attempt ${attempt}):`, err);
      if (attempt < MAX_RPC_RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  return false;
}

// Sum uiAmount delta across all token accounts owned by `owner` for the given mint.
// Positive = received, negative = sent.
function computeOwnerDelta(
  pre: any[],
  post: any[],
  owner: string,
  mint: string
): number {
  const sumFor = (balances: any[]) =>
    balances
      .filter((b) => b.owner === owner && b.mint === mint)
      .reduce((acc, b) => acc + parseFloat(b.uiTokenAmount?.uiAmountString || "0"), 0);
  return sumFor(post) - sumFor(pre);
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
