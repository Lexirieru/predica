export interface Candle {
  time: number; // unix seconds (lightweight-charts uses seconds)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PredictionMarket {
  id: string;
  symbol: string;
  question: string;
  targetPrice: number;
  currentPrice: number;
  deadline: number; // unix timestamp ms
  durationMin: number; // 1 | 5 | 15 — window length in minutes
  category: "crypto" | "defi" | "meme" | "layer1" | "layer2";
  yesPool: number;
  noPool: number;
  totalVoters: number;
  sentiment: number; // 0-100 bullish percentage
  candles: Candle[]; // OHLC candle data from Pacifica WS
  priceHistory: number[]; // kept for fallback
  status: "active" | "resolved" | "expired" | "settled";
  resolution?: "yes" | "no";
}

export type TradeSide = "yes" | "no";

export interface Vote {
  marketId: string;
  side: TradeSide;
  amount: number;
  timestamp: number;
}
