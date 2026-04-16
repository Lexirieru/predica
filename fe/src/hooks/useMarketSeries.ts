"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMarketSeries, type MarketSeries } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";

/**
 * Timeline series for a single symbol — past (settled) + live + upcoming buckets.
 * Refetches on MARKET_RESOLVED or when a bucket for this symbol flips to active
 * via NEW_MARKET, so the timeline below the chart stays in sync without polling.
 */
export function useMarketSeries(symbol: string | undefined, pastLimit = 12) {
  const [series, setSeries] = useState<MarketSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!symbol) return;
    try {
      const data = await fetchMarketSeries(symbol, pastLimit);
      setSeries(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbol, pastLimit]);

  useEffect(() => {
    load();
  }, [load]);

  // Any resolution for this symbol → refetch so past bucket lineup updates.
  useWebSocket("MARKET_RESOLVED", (data) => {
    const d = data as { marketId: string };
    if (!symbol || !series) return;
    const isOurs =
      series.live?.id === d.marketId ||
      series.past.some((m) => m.id === d.marketId) ||
      series.upcoming.some((m) => m.id === d.marketId);
    if (isOurs) load();
  });

  // Activator promoted an upcoming bucket → refetch to pick up the new live.
  useWebSocket("NEW_MARKET", (data) => {
    const raw = data as Record<string, unknown>;
    if (!symbol) return;
    if (String(raw.symbol).toUpperCase() === symbol.toUpperCase()) load();
  });

  return { series, loading, error, refetch: load };
}
