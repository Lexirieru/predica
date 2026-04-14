"use client";

import { useMemo } from "react";
import SwipeStack from "@/components/SwipeStack";
import { useMarkets } from "@/hooks/useMarkets";

export default function FeedPage() {
  const { markets, loading } = useMarkets();

  // Only show active, non-expired markets in the feed
  const activeMarkets = useMemo(
    () => markets.filter((m) => m.status === "active" && m.deadline > Date.now()),
    [markets]
  );

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
      <SwipeStack markets={activeMarkets} />
    </div>
  );
}
