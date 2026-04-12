export interface PredictionMarket {
  id: string;
  symbol: string;
  question: string;
  targetPrice: number;
  currentPrice: number;
  deadline: number; // unix timestamp ms
  category: "crypto" | "defi" | "meme" | "layer1" | "layer2";
  yesPool: number;
  noPool: number;
  totalVoters: number;
  sentiment: number; // 0-100 bullish percentage
  priceHistory: number[]; // simplified price array for mini chart
  status: "active" | "resolved" | "expired";
  resolution?: "yes" | "no";
}

export type TradeSide = "yes" | "no";

export interface Vote {
  marketId: string;
  side: TradeSide;
  amount: number;
  timestamp: number;
}
