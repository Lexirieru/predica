import nacl from "tweetnacl";
import bs58 from "bs58";

const BASE_URL = process.env.PACIFICA_API_URL || "https://test-api.pacifica.fi/api/v1";

// --- Public endpoints (no auth) ---

export async function getMarketInfo() {
  const res = await fetch(`${BASE_URL}/info`);
  if (!res.ok) throw new Error(`Pacifica /info failed: ${res.status}`);
  return res.json();
}

export async function getPrices() {
  const res = await fetch(`${BASE_URL}/info/prices`);
  if (!res.ok) throw new Error(`Pacifica /info/prices failed: ${res.status}`);
  return res.json();
}

export async function getOrderbook(symbol: string) {
  const res = await fetch(`${BASE_URL}/book?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Pacifica /book failed: ${res.status}`);
  return res.json();
}

export async function getKline(
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
) {
  const res = await fetch(
    `${BASE_URL}/kline?symbol=${symbol}&interval=${interval}&start_time=${startTime}&end_time=${endTime}`
  );
  if (!res.ok) throw new Error(`Pacifica /kline failed: ${res.status}`);
  return res.json();
}

export async function getTrades(symbol: string) {
  const res = await fetch(`${BASE_URL}/trades?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Pacifica /trades failed: ${res.status}`);
  return res.json();
}

export async function getFundingHistory(symbol: string) {
  const res = await fetch(`${BASE_URL}/funding_rate/history?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Pacifica /funding_rate/history failed: ${res.status}`);
  return res.json();
}

// --- Signing utilities ---

function sortKeysRecursively(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysRecursively);
  }
  if (obj !== null && typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysRecursively((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

function signPayload(payload: object, privateKeyBase58: string): string {
  const sorted = sortKeysRecursively(payload);
  const message = JSON.stringify(sorted);
  const messageBytes = new TextEncoder().encode(message);
  const secretKey = bs58.decode(privateKeyBase58);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return bs58.encode(signature);
}

function getPublicKey(privateKeyBase58: string): string {
  const secretKey = bs58.decode(privateKeyBase58);
  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
  return bs58.encode(keypair.publicKey);
}

// --- Authenticated endpoints ---

export async function createMarketOrder(
  symbol: string,
  amount: string,
  side: "bid" | "ask",
  slippagePercent: string = "0.5",
  reduceOnly: boolean = false,
  clientOrderId: string
) {
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) throw new Error("SOLANA_PRIVATE_KEY not set");

  const account = getPublicKey(privateKey);
  const timestamp = Date.now();

  const sigPayload = {
    timestamp,
    expiry_window: 5000,
    type: "create_market_order",
    data: {
      symbol,
      amount,
      side,
      slippage_percent: slippagePercent,
      reduce_only: reduceOnly,
      client_order_id: clientOrderId,
      builder_code: "PREDICA",
    },
  };

  const signature = signPayload(sigPayload, privateKey);

  const body = {
    account,
    agent_wallet: null,
    signature,
    timestamp,
    expiry_window: 5000,
    symbol,
    amount,
    side,
    slippage_percent: slippagePercent,
    reduce_only: reduceOnly,
    client_order_id: clientOrderId,
    builder_code: "PREDICA",
  };

  const res = await fetch(`${BASE_URL}/orders/create_market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pacifica create_market_order failed: ${res.status} — ${err}`);
  }
  return res.json();
}

export async function getPositions() {
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) throw new Error("SOLANA_PRIVATE_KEY not set");

  const account = getPublicKey(privateKey);
  const timestamp = Date.now();

  const sigPayload = {
    timestamp,
    expiry_window: 5000,
    type: "get_positions",
    data: {},
  };

  const signature = signPayload(sigPayload, privateKey);

  const res = await fetch(
    `${BASE_URL}/account/positions?account=${account}&signature=${signature}&timestamp=${timestamp}&expiry_window=5000`
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pacifica /account/positions failed: ${res.status} — ${err}`);
  }
  return res.json();
}

export async function getAccountInfo() {
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) throw new Error("SOLANA_PRIVATE_KEY not set");

  const account = getPublicKey(privateKey);
  const timestamp = Date.now();

  const sigPayload = {
    timestamp,
    expiry_window: 5000,
    type: "get_account_info",
    data: {},
  };

  const signature = signPayload(sigPayload, privateKey);

  const res = await fetch(
    `${BASE_URL}/account/info?account=${account}&signature=${signature}&timestamp=${timestamp}&expiry_window=5000`
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pacifica /account/info failed: ${res.status} — ${err}`);
  }
  return res.json();
}

// Close a position by placing a reduce-only market order in the opposite direction
export async function closePosition(
  symbol: string,
  amount: string,
  side: "bid" | "ask", // opposite of the original position
  clientOrderId: string
) {
  return createMarketOrder(symbol, amount, side, "1.0", true, clientOrderId);
}
