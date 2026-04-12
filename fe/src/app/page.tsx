"use client";

import SwipeStack from "@/components/SwipeStack";
import { useMarkets } from "@/hooks/useMarkets";

export default function FeedPage() {
  const { markets, loading } = useMarkets();

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full">
      <SwipeStack markets={markets} />
    </div>
  );
}
