"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PredictionMarket } from "@/lib/types";
import { fetchMarkets, fetchKline, fetchPrices } from "@/lib/api";
import { mockMarkets } from "@/lib/mock-data";
import { useStore } from "@/store/useStore";

export function useMarkets() {
  const [markets, setMarketsLocal] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const setStoreMarkets = useStore((s) => s.setMarkets);

  // Sync local state to store
  const setMarkets = useCallback((m: PredictionMarket[]) => {
    setMarketsLocal(m);
    // Use setTimeout to avoid "Cannot update a component while rendering another component"
    setTimeout(() => setStoreMarkets(m), 0);
  }, [setStoreMarkets]);

  const load = useCallback(async () => {
    try {
      // Fetch markets from backend
      const data = await fetchMarkets();

      if (!mounted.current) return;

      if (data.length === 0) {
        // Fallback to mock data if backend has no markets
        setMarkets(mockMarkets);
        setLoading(false);
        return;
      }

      // Fetch kline data for price history in parallel
      const withHistory = await Promise.all(
        data.map(async (m) => {
          const history = await fetchKline(m.symbol);
          return {
            ...m,
            priceHistory: history.length >= 2
              ? history.slice(-12)
              : generateFallbackHistory(m.currentPrice),
          };
        })
      );

      if (!mounted.current) return;
      setMarkets(withHistory);
      setError(null);
    } catch {
      if (!mounted.current) return;
      // Fallback to mock data on error
      setMarkets(mockMarkets);
      setError("Using offline data");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Refresh prices every second — rolling chart
  const refreshPrices = useCallback(async () => {
    try {
      const prices = await fetchPrices();
      setMarketsLocal((prev) => {
        const updated = prev.map((m) => {
          const p = prices[m.symbol];
          if (p?.mark) {
            const newPrice = parseFloat(p.mark);
            // Push new price to history, keep last 30 points for rolling chart
            const history = [...m.priceHistory, newPrice];
            if (history.length > 30) history.shift();
            return { ...m, currentPrice: newPrice, priceHistory: history };
          }
          return m;
        });
        setTimeout(() => setStoreMarkets(updated), 0);
        return updated;
      });
    } catch {
      // ignore price refresh errors
    }
  }, [setStoreMarkets]);

  useEffect(() => {
    mounted.current = true;
    load();
    const interval = setInterval(refreshPrices, 1000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [load, refreshPrices]);

  return { markets, loading, error, refetch: load };
}

function generateFallbackHistory(currentPrice: number): number[] {
  const points: number[] = [];
  let price = currentPrice * (0.9 + Math.random() * 0.1);
  for (let i = 0; i < 12; i++) {
    price += (currentPrice - price) * 0.2 + (Math.random() - 0.5) * currentPrice * 0.02;
    points.push(price);
  }
  points[points.length - 1] = currentPrice;
  return points;
}
