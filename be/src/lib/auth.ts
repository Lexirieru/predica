import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Verifikasi signature Solana (Ed25519)
 * @param message Pesan teks yang di-sign
 * @param signature Base58 encoded signature
 * @param publicKey Base58 encoded wallet address
 */
export function verifySolanaSignature(message: string, signature: string, publicKey: string): boolean {
  try {
    const msgUint8 = new TextEncoder().encode(message);
    const sigUint8 = bs58.decode(signature);
    const pubKeyUint8 = bs58.decode(publicKey);

    return nacl.sign.detached.verify(msgUint8, sigUint8, pubKeyUint8);
  } catch (err) {
    console.error("[Auth] Signature Verification Failed:", err);
    return false;
  }
}

/**
 * Generate standard message format for Predica
 * Membantu frontend & backend punya pesan yang sama buat di-sign
 */
export function getAuthMessage(action: string, wallet: string, timestamp: number): string {
  return `Predica Auth: ${action} by ${wallet} at ${timestamp}`;
}
