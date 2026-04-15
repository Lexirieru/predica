import bs58 from "bs58";

// Matches be/src/lib/auth.ts getAuthMessage. Keep in sync if BE changes format.
export function buildAuthMessage(action: string, wallet: string, timestamp: number): string {
  return `Predica Auth: ${action} by ${wallet} at ${timestamp}`;
}

export interface AuthHeaders {
  "x-signature": string;
  "x-timestamp": string;
}

interface Signer {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Sign a Predica auth message with the connected wallet and return headers
 * ready to spread into a fetch() call. Centralized so every signed endpoint
 * uses the exact same format — wrong formatting silently fails with 401.
 */
export async function signAuthHeaders(
  provider: Signer,
  action: string,
  wallet: string,
): Promise<{ headers: AuthHeaders; timestamp: number }> {
  const timestamp = Date.now();
  const message = buildAuthMessage(action, wallet, timestamp);
  const encoded = new TextEncoder().encode(message);
  const sigBytes = await provider.signMessage(encoded);
  return {
    headers: {
      "x-signature": bs58.encode(sigBytes),
      "x-timestamp": String(timestamp),
    },
    timestamp,
  };
}
