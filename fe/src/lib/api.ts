import { PredictionMarket, TradeSide, Candle } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// All fetches in this module get an abort timeout. Without it, a wedged
// upstream would freeze a UI flow indefinitely — the wallet-connect path
// in particular calls several of these in sequence.
const API_TIMEOUT_MS = 10_000;

function api(path: string, init: RequestInit = {}): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(API_TIMEOUT_MS);
  const signal = init.signal
    ? AbortSignal.any([init.signal as AbortSignal, timeoutSignal])
    : timeoutSignal;
  return fetch(`${API_URL}${path}`, { ...init, signal });
}

function mapMarket(raw: any): PredictionMarket {
  return {
    id: raw.id,
    symbol: raw.symbol,
    question: raw.question,
    targetPrice: Number(raw.targetPrice || raw.target_price || 0),
    currentPrice: Number(raw.currentPrice || raw.current_price || 0),
    deadline: Number(raw.deadline || 0),
    category: raw.category || "crypto",
    yesPool: Number(raw.yesPool || raw.yes_pool || 0),
    noPool: Number(raw.noPool || raw.no_pool || 0),
    totalVoters: Number(raw.totalVoters || raw.total_voters || 0),
    sentiment: Number(raw.sentiment || 50),
    candles: [],
    priceHistory: [],
    status: raw.status || "active",
    resolution: raw.resolution,
  };
}

export async function fetchMarkets(): Promise<PredictionMarket[]> {
  const res = await api(`/api/markets`);
  if (!res.ok) throw new Error("Failed to fetch markets");
  const data = await res.json();
  return (data as Record<string, unknown>[]).map(mapMarket);
}

export async function fetchAllMarkets(): Promise<PredictionMarket[]> {
  const res = await api(`/api/markets/all`);
  if (!res.ok) throw new Error("Failed to fetch all markets");
  const data = await res.json();
  return (data as Record<string, unknown>[]).map(mapMarket);
}

export async function fetchMarket(id: string): Promise<PredictionMarket> {
  const res = await api(`/api/markets/${id}`);
  if (!res.ok) throw new Error("Failed to fetch market");
  const data = await res.json();
  return mapMarket(data);
}

export async function fetchPrices(): Promise<Record<string, { mark: string; oracle: string }>> {
  const res = await api(`/api/prices`);
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

export async function fetchCandles(symbol: string): Promise<number[]> {
  try {
    const res = await api(`/api/prices/candles/${symbol}`);
    if (!res.ok) return [];
    const json = await res.json();
    const candles = json.data || [];
    if (!Array.isArray(candles)) return [];
    return candles.map((c: { c?: number; close?: number }) =>
      Number(c.c || c.close || 0)
    ).filter((v: number) => v > 0);
  } catch {
    return [];
  }
}

/**
 * Fetch full OHLC candles from the persistent BE cache (falls through to DB,
 * then Pacifica REST). Replaces the old close-only fetchCandles for chart seed.
 *
 * `window` determines history depth — 1h is sufficient for a 5-min market,
 * 24h for timeline views that need to show past buckets in context.
 */
export async function fetchCandleSeries(
  symbol: string,
  window: "1h" | "2h" | "6h" | "24h" = "1h",
): Promise<Candle[]> {
  try {
    const res = await api(`/api/prices/candles/${symbol}?window=${window}`);
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json.data || [];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((c: { t?: number; o?: number; c?: number; h?: number; l?: number }) => ({
        time: Math.floor(Number(c.t ?? 0) / 1000), // lightweight-charts expects seconds
        open: Number(c.o ?? 0),
        high: Number(c.h ?? 0),
        low: Number(c.l ?? 0),
        close: Number(c.c ?? 0),
      }))
      .filter((c: Candle) => c.time > 0 && c.close > 0);
  } catch {
    return [];
  }
}

export interface MarketSeries {
  symbol: string;
  past: PredictionMarket[];       // settled, oldest first
  live: PredictionMarket | null;   // currently active
  upcoming: PredictionMarket[];    // scheduled, soonest first
}

/**
 * Timeline view for a single symbol: past (settled) + live + upcoming buckets.
 * Used for Polymarket-style series tabs below the chart.
 */
export async function fetchMarketSeries(symbol: string, past = 12): Promise<MarketSeries> {
  const res = await api(`/api/markets/symbol/${symbol}?past=${past}`);
  if (!res.ok) throw new Error("Failed to fetch market series");
  const json = await res.json();
  return {
    symbol: json.symbol,
    past: (json.past || []).map(mapMarket),
    live: json.live ? mapMarket(json.live) : null,
    upcoming: (json.upcoming || []).map(mapMarket),
  };
}

export interface PortfolioStats {
  wallet: string;
  balance: number;
  totalVotes: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  totalWagered: number;
  totalPnl: number;
  roi: number;
  avgBet: number;
  biggestWin: number;
  biggestLoss: number;
  totalDeposits: number;
  totalWithdrawals: number;
}

export async function fetchPortfolioStats(wallet: string): Promise<PortfolioStats> {
  const res = await api(`/api/portfolio/${wallet}/stats`);
  if (!res.ok) throw new Error("Failed to fetch portfolio stats");
  return res.json();
}

export async function placeVote(
  marketId: string,
  userWallet: string,
  side: TradeSide,
  amount: number,
  signature: string,
  timestamp: number
) {
  const res = await api(`/api/vote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": signature,
      "x-timestamp": String(timestamp),
    },
    body: JSON.stringify({ marketId, userWallet, side, amount }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Vote failed" }));
    throw new Error(err.error || "Vote failed");
  }
  return res.json();
}

export async function fetchUserVotes(wallet: string) {
  const res = await api(`/api/vote/user/${wallet}`);
  if (!res.ok) throw new Error("Failed to fetch user votes");
  return res.json();
}

export async function fetchLeaderboard() {
  const res = await api(`/api/leaderboard`);
  if (!res.ok) throw new Error("Failed to fetch leaderboard");
  return res.json();
}

// Wallet / Balance
export async function fetchBalance(wallet: string): Promise<{ balance: number; totalDeposits: number; totalWithdrawals: number }> {
  const res = await api(`/api/wallet/balance/${wallet}`);
  if (!res.ok) throw new Error("Failed to fetch balance");
  return res.json();
}

export async function verifyDeposit(wallet: string, amount: number, txSignature: string) {
  const res = await api(`/api/wallet/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, amount, txSignature }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Deposit verification failed");
  return data;
}

export async function requestWithdraw(
  wallet: string,
  amount: number,
  signature: string,
  timestamp: number,
) {
  const res = await api(`/api/wallet/withdraw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": signature,
      "x-timestamp": String(timestamp),
    },
    body: JSON.stringify({ wallet, amount }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Withdrawal failed");
  return data;
}

export async function fetchTransactions(wallet: string) {
  const res = await api(`/api/wallet/transactions/${wallet}`);
  if (!res.ok) throw new Error("Failed to fetch transactions");
  return res.json();
}

export interface SentimentResponse {
  symbol: string;
  bullishPercent: number;
  mentionCount: number;
  source: "llm" | "engagement" | "neutral";
  confidence: "high" | "medium" | "low";
  summary?: string;
  topMentions?: Array<{ link: string; likes: number; reposts: number; views: number }>;
  lastUpdated: number;
  refreshing: boolean;
}

export async function fetchSentiment(symbol: string): Promise<SentimentResponse> {
  const res = await api(`/api/sentiment/${symbol}`);
  if (!res.ok) throw new Error("Failed to fetch sentiment");
  return res.json();
}
