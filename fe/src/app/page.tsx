"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SwipeStack from "@/components/SwipeStack";
import { useMarkets } from "@/hooks/useMarkets";

export default function FeedPage() {
  const { markets, loading, refetch } = useMarkets();

  // Settled market IDs the user has dismissed via the "Go to live market"
  // button. bySymbol skips these so the feed advances to the next live bucket.
  // When a NEW bucket later settles (different id), user gets pinned again.
  const [dismissedSettled, setDismissedSettled] = useState<Set<string>>(new Set());

  const handleAdvance = useCallback((marketId: string) => {
    setDismissedSettled((prev) => {
      if (prev.has(marketId)) return prev;
      const next = new Set(prev);
      next.add(marketId);
      return next;
    });
  }, []);

  // One card per symbol with STICKY-SETTLED behavior:
  //   - If a settled 5m bucket exists and user hasn't dismissed it,
  //     show it (chart frozen + "Go to live market" button).
  //   - Otherwise show the live bucket.
  // This replaces auto-advance: user sees settlement outcome and manually
  // clicks the button when they want to move to the next round.
  const activeMarkets = useMemo(() => {
    const now = Date.now();
    const fives = markets;
    const bySymbol = new Map<string, typeof fives[number]>();
    for (const m of fives) {
      const live = m.status === "active" && m.deadline > now;
      const settled = m.status === "settled" || m.status === "resolved";
      if (!live && !settled) continue;
      if (settled && dismissedSettled.has(m.id)) continue;

      const existing = bySymbol.get(m.symbol);
      if (!existing) {
        bySymbol.set(m.symbol, m);
        continue;
      }
      const existingSettled =
        existing.status === "settled" || existing.status === "resolved";

      // Settled (not dismissed) takes priority over live — sticky behavior.
      if (settled && !existingSettled) {
        bySymbol.set(m.symbol, m);
        continue;
      }
      if (!settled && existingSettled) {
        continue; // keep the pinned settled
      }
      // Both same category: prefer the one with the later deadline.
      if (m.deadline > existing.deadline) {
        bySymbol.set(m.symbol, m);
      }
    }
    return Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [markets, dismissedSettled]);

  // Fallback polling when feed is empty. Backend broadcasts NEW_MARKET via WS
  // when activator promotes upcoming → active, but FE can miss that event if
  // the tab was throttled, WS dropped a frame, or there's a tiny gap between
  // settlement and bucket activation. Without this, user stays on
  // "Waiting for new markets..." forever even though the BE has new ones.
  // Poll every 4s while empty; auto-stops once we have markets again.
  useEffect(() => {
    if (loading || activeMarkets.length > 0) return;
    const id = setInterval(() => refetch(), 4000);
    return () => clearInterval(id);
  }, [loading, activeMarkets.length, refetch]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (activeMarkets.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-white/30 text-sm">Waiting for new markets...</p>
      </div>
    );
  }

  return (
    <div className="h-full">
      <SwipeStack markets={activeMarkets} onAdvance={handleAdvance} />
    </div>
  );
}
