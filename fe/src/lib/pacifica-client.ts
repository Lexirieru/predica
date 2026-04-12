// Frontend Pacifica client — signs with user's wallet via Privy

const PACIFICA_URL = process.env.NEXT_PUBLIC_PACIFICA_API_URL || "https://test-api.pacifica.fi/api/v1";

// Recursively sort all JSON keys alphabetically
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// Prepare the message to sign (same as Python SDK's prepare_message)
function prepareMessage(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const data = { ...header, data: payload };
  const sorted = sortKeys(data);
  // Compact JSON — no whitespace, same as Python's separators=(",", ":")
  return JSON.stringify(sorted);
}

// Sign and submit a market order to Pacifica
export async function createMarketOrder(params: {
  symbol: string;
  amount: string;
  side: "bid" | "ask"; // bid = long = Up, ask = short = Down
  slippagePercent?: string;
  reduceOnly?: boolean;
  walletAddress: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}) {
  const { symbol, amount, side, walletAddress, signMessage } = params;
  const slippagePercent = params.slippagePercent || "0.5";
  const reduceOnly = params.reduceOnly || false;
  const clientOrderId = crypto.randomUUID();

  const timestamp = Date.now();

  // 1. Build signature header + payload (exactly like Python SDK)
  const signatureHeader = {
    timestamp,
    expiry_window: 5000,
    type: "create_market_order",
  };

  const signaturePayload: Record<string, unknown> = {
    symbol,
    amount,
    side,
    slippage_percent: slippagePercent,
    reduce_only: reduceOnly,
    client_order_id: clientOrderId,
  };

  // 2. Prepare message (sort keys, compact JSON)
  const message = prepareMessage(signatureHeader, signaturePayload);
  const messageBytes = new TextEncoder().encode(message);

  // 3. User signs with their wallet
  const signatureBytes = await signMessage(messageBytes);

  // 4. Encode signature to base58
  const signature = base58Encode(signatureBytes);

  // 5. Build request body
  const requestBody = {
    account: walletAddress,
    signature,
    timestamp,
    expiry_window: 5000,
    ...signaturePayload,
  };

  // 6. Send to Pacifica
  const res = await fetch(`${PACIFICA_URL}/orders/create_market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Pacifica order failed: ${res.status}`);
  }

  return { ...data, clientOrderId };
}

// Base58 encoding (Bitcoin alphabet)
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = "";
  for (const byte of bytes) {
    if (byte === 0) result += BASE58_ALPHABET[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

// Fetch live prices
export async function fetchPacificaPrices() {
  const res = await fetch(`${PACIFICA_URL}/info/prices`);
  if (!res.ok) throw new Error("Failed to fetch prices");
  return res.json();
}
