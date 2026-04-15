"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PredictionMarket } from "@/lib/types";
import { fetchMarkets } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { useCandleStore } from "@/store/useCandleStore";
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

  // Initial load — metadata only. Candles are fetched on-demand by the
  // visible card via useCandlesFor (useCandleStore), which dedupes and caches
  // per symbol. Previously we Promise.all'd candle fetches for every market
  // which ballooned TTI with 1m/5m/15m buckets in the feed.
  const load = useCallback(async () => {
    try {
      const data = await fetchMarkets();
      if (!mounted.current) return;
      sync(data);
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

  // Refetch the full market list after a WS reconnect. Any messages the server
  // broadcast while we were offline are lost — a clean refetch is the simplest
  // way to resync. Event is emitted only on the 2nd+ open, so no redundant
  // fetch on initial page load.
  useWebSocket("_RECONNECTED", () => {
    load();
  });

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

  // WS: CANDLE_UPDATE — delegate to candle store. Also mirror close price
  // into market.currentPrice so the chart's live dot stays in sync between
  // PRICE_UPDATE ticks.
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

    useCandleStore.getState().upsertCandle(raw.symbol, {
      time: Math.floor(raw.openTime / 1000),
      open: raw.open,
      high: raw.high,
      low: raw.low,
      close: raw.close,
    });

    setMarketsLocal((prev) => {
      const updated = prev.map((m) =>
        m.symbol.toUpperCase() === raw.symbol.toUpperCase()
          ? { ...m, currentPrice: raw.close }
          : m,
      );
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
      // Dedupe: upgrade existing market by id if present. Candles live in
      // useCandleStore keyed by symbol, so bucket rotation keeps the chart
      // series intact without FE needing to hand-carry it.
      const existingById = prev.find((m) => m.id === raw.id);

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
        candles: [],
        priceHistory: [],
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

  // WS: NEW_VOTE — absolute pool totals from server. We overwrite the market
  // pool/voters with the server-authoritative values. For the user who voted
  // via optimistic flow, the optimistic update already set the same values
  // (amount + pre-vote pool == absolute pool), so this overwrite is a no-op.
  // For spectators, this is their only path to see pool grow in real time.
  useWebSocket("NEW_VOTE", (data) => {
    const v = data as {
      marketId: string;
      yesPool?: number;
      noPool?: number;
      totalVoters?: number;
    };
    if (!v.marketId) return;
    // Legacy payload without pool totals: skip (can't reconcile absolute).
    if (v.yesPool === undefined || v.noPool === undefined) return;
    setMarketsLocal((prev) => {
      let changed = false;
      const updated = prev.map((m) => {
        if (m.id !== v.marketId) return m;
        if (
          m.yesPool === v.yesPool &&
          m.noPool === v.noPool &&
          m.totalVoters === (v.totalVoters ?? m.totalVoters)
        ) {
          return m;
        }
        changed = true;
        return {
          ...m,
          yesPool: v.yesPool!,
          noPool: v.noPool!,
          totalVoters: v.totalVoters ?? m.totalVoters,
        };
      });
      if (!changed) return prev;
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
