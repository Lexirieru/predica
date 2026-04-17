"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SwipeStack from "@/components/SwipeStack";
import DesktopFeed from "@/components/DesktopFeed";
import { useMarkets } from "@/hooks/useMarkets";
import { useIsDesktop } from "@/hooks/useIsDesktop";

export default function FeedPage() {
  const { markets, loading, refetch } = useMarkets();
  const isDesktop = useIsDesktop();

  // Settled market IDs the user has dismissed via the "Go to live market"
  // button. bySymbol skips these so the feed advances to the next live bucket.
  // When a NEW bucket later settles (different id), user gets pinned again.
  const [dismissedSettled, setDismissedSettled] = useState<Set<string>>(new Set());

  // One-click "Go to live market" advances ALL settled cards to their live
  // buckets — not just the one whose button was clicked. The user sees a
  // wall of settled cards at the 5m boundary; making them tap each one is
  // tedious, and the intent of the button is "show me the live feed now".
  const handleAdvance = useCallback(() => {
    setDismissedSettled((prev) => {
      const next = new Set(prev);
      for (const m of markets) {
        if (m.status === "settled" || m.status === "resolved") {
          next.add(m.id);
        }
      }
      return next;
    });
  }, [markets]);

  // One card per (symbol + durationMin) with STICKY-SETTLED behavior:
  //   - If a settled bucket of that duration exists and user hasn't dismissed
  //     it, show it (chart frozen + "Go to live market" button).
  //   - Otherwise show the live bucket.
  // Each symbol can appear twice in the feed (one 5m card + one 15m card)
  // so users can swipe between both durations. Order is randomized per
  // session to avoid always seeing the same symbol/duration first.
  const [shuffleSeed] = useState(() => Math.random());
  const activeMarkets = useMemo(() => {
    const now = Date.now();
    const byKey = new Map<string, (typeof markets)[number]>();
    for (const m of markets) {
      const live = m.status === "active" && m.deadline > now;
      const settled = m.status === "settled" || m.status === "resolved";
      if (!live && !settled) continue;
      if (settled && dismissedSettled.has(m.id)) continue;

      const key = `${m.symbol}:${m.durationMin}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, m);
        continue;
      }
      const existingSettled =
        existing.status === "settled" || existing.status === "resolved";

      // Settled (not dismissed) takes priority over live — sticky behavior.
      if (settled && !existingSettled) {
        byKey.set(key, m);
        continue;
      }
      if (!settled && existingSettled) {
        continue; // keep the pinned settled
      }
      // Both same category: prefer the one with the later deadline.
      if (m.deadline > existing.deadline) {
        byKey.set(key, m);
      }
    }
    // Stable pseudo-random shuffle (per-session, same seed every render so
    // order doesn't flip on re-render). Hash combines id + seed.
    const list = Array.from(byKey.values());
    return list.sort((a, b) => {
      const ha = ((a.id.charCodeAt(0) * 131) % 1000) / 1000 + shuffleSeed;
      const hb = ((b.id.charCodeAt(0) * 131) % 1000) / 1000 + shuffleSeed;
      return (ha % 1) - (hb % 1);
    });
  }, [markets, dismissedSettled, shuffleSeed]);

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
      {isDesktop ? (
        <DesktopFeed markets={activeMarkets} onAdvance={handleAdvance} />
      ) : (
        <SwipeStack markets={activeMarkets} onAdvance={handleAdvance} />
      )}
    </div>
  );
}
