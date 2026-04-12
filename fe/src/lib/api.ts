import { PredictionMarket, TradeSide } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Map backend snake_case to frontend camelCase
function mapMarket(raw: Record<string, unknown>): PredictionMarket {
  return {
    id: raw.id as string,
    symbol: raw.symbol as string,
    question: raw.question as string,
    targetPrice: raw.target_price as number,
    currentPrice: raw.current_price as number,
    deadline: raw.deadline as number,
    category: (raw.category as PredictionMarket["category"]) || "crypto",
    yesPool: raw.yes_pool as number,
    noPool: raw.no_pool as number,
    totalVoters: raw.total_voters as number,
    sentiment: raw.sentiment as number,
    priceHistory: [], // will be filled by kline data
    status: raw.status as PredictionMarket["status"],
    resolution: raw.resolution as PredictionMarket["resolution"],
  };
}

export async function fetchMarkets(): Promise<PredictionMarket[]> {
  const res = await fetch(`${API_URL}/api/markets`);
  if (!res.ok) throw new Error("Failed to fetch markets");
  const data = await res.json();
  return (data as Record<string, unknown>[]).map(mapMarket);
}

export async function fetchMarket(id: string): Promise<PredictionMarket> {
  const res = await fetch(`${API_URL}/api/markets/${id}`);
  if (!res.ok) throw new Error("Failed to fetch market");
  const data = await res.json();
  return mapMarket(data);
}

export async function fetchPrices(): Promise<Record<string, { mark: string; oracle: string }>> {
  const res = await fetch(`${API_URL}/api/prices`);
  if (!res.ok) throw new Error("Failed to fetch prices");
  const json = await res.json();
  // Pacifica returns { success, data: [...] }
  const list = json.data || json;
  const map: Record<string, { mark: string; oracle: string }> = {};
  if (Array.isArray(list)) {
    for (const item of list) {
      map[item.symbol] = { mark: item.mark, oracle: item.oracle };
    }
  }
  return map;
}

export async function fetchKline(symbol: string): Promise<number[]> {
  try {
    const res = await fetch(`${API_URL}/api/prices/kline/${symbol}?interval=1h`);
    if (!res.ok) return [];
    const json = await res.json();
    const candles = json.data || json;
    if (!Array.isArray(candles)) return [];
    return candles.map((c: { close?: string; c?: string }) =>
      parseFloat(c.close || c.c || "0")
    ).filter((v: number) => v > 0);
  } catch {
    return [];
  }
}

export async function placeVote(
  marketId: string,
  userWallet: string,
  side: TradeSide,
  amount: number
) {
  const res = await fetch(`${API_URL}/api/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ marketId, userWallet, side, amount }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Vote failed" }));
    throw new Error(err.error || "Vote failed");
  }
  return res.json();
}

export async function fetchUserVotes(wallet: string) {
  const res = await fetch(`${API_URL}/api/vote/user/${wallet}`);
  if (!res.ok) throw new Error("Failed to fetch user votes");
  return res.json();
}

export async function fetchLeaderboard() {
  const res = await fetch(`${API_URL}/api/leaderboard`);
  if (!res.ok) throw new Error("Failed to fetch leaderboard");
  return res.json();
}

// Wallet / Balance
export async function fetchBalance(wallet: string): Promise<{ balance: number; totalDeposits: number; totalWithdrawals: number }> {
  const res = await fetch(`${API_URL}/api/wallet/balance/${wallet}`);
  if (!res.ok) throw new Error("Failed to fetch balance");
  return res.json();
}

export async function verifyDeposit(wallet: string, amount: number, txSignature: string) {
  const res = await fetch(`${API_URL}/api/wallet/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, amount, txSignature }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Deposit verification failed");
  return data;
}

export async function requestWithdraw(wallet: string, amount: number) {
  const res = await fetch(`${API_URL}/api/wallet/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, amount }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Withdrawal failed");
  return data;
}
