"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PredictionMarket, Candle } from "@/lib/types";
import { fetchMarkets, fetchCandles } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { useWebSocket } from "./useWebSocket";

function parseCandles(raw: number[]): Candle[] {
  // fetchCandles returns close prices only — convert to basic candles for fallback
  return raw.map((c, i) => ({
    time: Math.floor(Date.now() / 1000) - (raw.length - i) * 60,
    open: c, high: c, low: c, close: c,
  }));
}

export function useMarkets() {
  const [markets, setMarketsLocal] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const setStoreMarkets = useStore((s) => s.setMarkets);

  const sync = useCallback((m: PredictionMarket[]) => {
    setMarketsLocal(m);
    setTimeout(() => setStoreMarkets(m), 0);
  }, [setStoreMarkets]);

  // Initial load — seed candles from /api/prices/candles/:symbol
  const load = useCallback(async () => {
    try {
      const data = await fetchMarkets();
      if (!mounted.current) return;

      const withCandles = await Promise.all(
        data.map(async (m) => {
          const closes = await fetchCandles(m.symbol);
          const candles: Candle[] = closes.length >= 2
            ? parseCandles(closes.slice(-60))
            : [{ time: Math.floor(Date.now() / 1000), open: m.currentPrice, high: m.currentPrice, low: m.currentPrice, close: m.currentPrice }];
          return { ...m, candles, priceHistory: closes.slice(-30) };
        })
      );

      if (!mounted.current) return;
      sync(withCandles);
      setError(null);
    } catch {
      if (!mounted.current) return;
      setError("Failed to load markets");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [sync]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  // WS: PRICE_UPDATE
  useWebSocket("PRICE_UPDATE", (data) => {
    const prices = data as Record<string, number>;
    setMarketsLocal((prev) => {
      const updated = prev.map((m) => {
        const mark = prices[m.symbol] || prices[m.symbol.toUpperCase()];
        if (mark && mark > 0) {
          return { ...m, currentPrice: mark };
        }
        return m;
      });
      setTimeout(() => setStoreMarkets(updated), 0);
      return updated;
    });
  });

  // WS: CANDLE_UPDATE — full OHLC from Pacifica via backend
  useWebSocket("CANDLE_UPDATE", (data) => {
    const raw = data as {
      symbol: string;
      openTime: number;
      closeTime: number;
      open: number;
      close: number;
      high: number;
      low: number;
    };
    if (!raw.symbol || !raw.close) return;

    const candleTime = Math.floor(raw.openTime / 1000); // lightweight-charts uses seconds

    setMarketsLocal((prev) => {
      const updated = prev.map((m) => {
        if (m.symbol.toUpperCase() !== raw.symbol.toUpperCase()) return m;

        const candles = [...m.candles];
        const last = candles[candles.length - 1];

        const newCandle: Candle = {
          time: candleTime,
          open: raw.open,
          high: raw.high,
          low: raw.low,
          close: raw.close,
        };

        if (last && last.time === candleTime) {
          // Update existing candle (still forming)
          candles[candles.length - 1] = newCandle;
        } else {
          // New candle
          candles.push(newCandle);
          if (candles.length > 60) candles.shift();
        }

        return { ...m, candles, currentPrice: raw.close };
      });
      setTimeout(() => setStoreMarkets(updated), 0);
      return updated;
    });
  });

  // WS: NEW_MARKET
  useWebSocket("NEW_MARKET", (data) => {
    const raw = data as Record<string, unknown>;
    const price = Number(raw.currentPrice || raw.current_price || 0);
    const market: PredictionMarket = {
      id: raw.id as string,
      symbol: raw.symbol as string,
      question: raw.question as string,
      targetPrice: Number(raw.targetPrice || raw.target_price || 0),
      currentPrice: price,
      deadline: Number(raw.deadline || 0),
      category: (raw.category as PredictionMarket["category"]) || "crypto",
      yesPool: Number(raw.yesPool || raw.yes_pool || 0),
      noPool: Number(raw.noPool || raw.no_pool || 0),
      totalVoters: Number(raw.totalVoters || raw.total_voters || 0),
      sentiment: Number(raw.sentiment || 50),
      candles: [{ time: Math.floor(Date.now() / 1000), open: price, high: price, low: price, close: price }],
      priceHistory: [price],
      status: "active",
      resolution: undefined,
    };
    setMarketsLocal((prev) => {
      const updated = [...prev, market];
      setTimeout(() => setStoreMarkets(updated), 0);
      return updated;
    });
  });

  // WS: MARKET_RESOLVED
  useWebSocket("MARKET_RESOLVED", (data) => {
    const { marketId, resolution } = data as { marketId: string; resolution: string };
    setMarketsLocal((prev) => {
      const updated = prev.map((m) =>
        m.id === marketId ? { ...m, status: "resolved" as const, resolution: resolution as "yes" | "no" } : m
      );
      setTimeout(() => setStoreMarkets(updated), 0);
      return updated;
    });
  });

  return { markets, loading, error, refetch: load };
}
