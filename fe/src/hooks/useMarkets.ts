"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PredictionMarket, Candle } from "@/lib/types";
import { fetchMarkets, fetchCandleSeries } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { useWebSocket } from "./useWebSocket";

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
          // Prefer full OHLC from BE persistent cache (candle_snapshots → cache → REST).
          const ohlc = await fetchCandleSeries(m.symbol, "1h");
          const candles: Candle[] = ohlc.length >= 2
            ? ohlc.slice(-60)
            : [{ time: Math.floor(Date.now() / 1000), open: m.currentPrice, high: m.currentPrice, low: m.currentPrice, close: m.currentPrice }];
          const priceHistory = candles.map((c) => c.close).slice(-30);
          return { ...m, candles, priceHistory };
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

  // WS: NEW_MARKET — fired by both the bucket generator ("upcoming" created) and
  // the activator ("upcoming" → "active"). The feed only surfaces active rows;
  // upcoming pre-created slots are ignored here (they show up via the series
  // endpoint when FE renders a timeline).
  useWebSocket("NEW_MARKET", (data) => {
    const raw = data as Record<string, unknown>;
    const status = (raw.status as string) || "active";
    if (status !== "active") return;

    const price = Number(raw.currentPrice || raw.current_price || 0);
    const symbol = raw.symbol as string;

    setMarketsLocal((prev) => {
      // Dedupe: if we already have this market id, upgrade it; else carry
      // forward the in-memory candle buffer for this symbol so the chart
      // doesn't reset when a bucket rotates.
      const existingById = prev.find((m) => m.id === raw.id);
      const existingBySymbol = prev.find((m) => m.symbol.toUpperCase() === symbol.toUpperCase());
      const inheritedCandles = existingBySymbol?.candles ?? [
        { time: Math.floor(Date.now() / 1000), open: price, high: price, low: price, close: price },
      ];

      const market: PredictionMarket = {
        id: raw.id as string,
        symbol,
        question: raw.question as string,
        targetPrice: Number(raw.targetPrice || raw.target_price || 0),
        currentPrice: price,
        deadline: Number(raw.deadline || 0),
        durationMin: Number(raw.durationMin ?? raw.duration_min ?? 5),
        category: (raw.category as PredictionMarket["category"]) || "crypto",
        yesPool: Number(raw.yesPool || raw.yes_pool || 0),
        noPool: Number(raw.noPool || raw.no_pool || 0),
        totalVoters: Number(raw.totalVoters || raw.total_voters || 0),
        sentiment: Number(raw.sentiment || 50),
        candles: inheritedCandles,
        priceHistory: inheritedCandles.map((c) => c.close).slice(-30),
        status: "active",
        resolution: undefined,
      };

      const updated = existingById
        ? prev.map((m) => (m.id === market.id ? market : m))
        : [...prev, market];
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
