"use client";

import { memo } from "react";
import type { PredictionMarket } from "@/lib/types";
import { useNow } from "@/hooks/useNow";

type Variant = "past" | "live" | "upcoming";

interface Props {
  market: PredictionMarket;
  variant: Variant;
  onClick?: () => void;
  /** Past variant only — highlight if this is the currently frozen bucket. */
  active?: boolean;
}

// All market times display in UTC so deadlines are unambiguous for a global
// user base. Don't swap to local TZ without product sign-off.
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function formatTime(ms: number): string {
  return `${TIME_FMT.format(new Date(ms))} UTC`;
}

function BucketPillInner({ market, variant, onClick, active }: Props) {
  const now = useNow(30_000);
  const endLabel = formatTime(market.deadline);

  if (variant === "live") {
    return (
      <button
        onClick={onClick}
        className="shrink-0 px-3 py-1.5 rounded-full bg-white/6 border border-white/1 flex items-center gap-1.5 hover:bg-white/1 transition-colors"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#dc3246] opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#dc3246]" />
        </span>
        <span className="text-xs font-medium text-white tabular-nums">{endLabel}</span>
      </button>
    );
  }

  if (variant === "past") {
    return (
      <button
        onClick={onClick}
        className={`shrink-0 px-3 py-1.5 rounded-lg transition-colors ${
          active
            ? "bg-white text-black"
            : "bg-white/6 border border-white/8 text-white/70 hover:bg-white/1"
        }`}
      >
        <span className="text-xs font-medium tabular-nums">{endLabel}</span>
      </button>
    );
  }

  // upcoming
  const opensIn = market.deadline - market.durationMin * 60_000 - now;
  const opensInMin = Math.max(0, Math.round(opensIn / 60000));
  return (
    <button
      onClick={onClick}
      className="shrink-0 px-3 py-1.5 rounded-lg bg-white/3 border border-dashed border-white/10 text-white/35 hover:text-white/50 transition-colors"
      title={opensInMin > 0 ? `Opens in ${opensInMin}m` : "Opening soon"}
    >
      <span className="text-xs font-medium tabular-nums">{endLabel}</span>
    </button>
  );
}

// Memoized so the timeline's map doesn't re-render every pill on unrelated
// parent updates (chart ticks, WS broadcasts). Intentionally skips onClick
// identity: parents pass inline arrows whose identity changes each render,
// but the handler behavior is determined by the bucket id (captured in the
// closure) which we DO compare — stale handlers fire with equivalent `m`.
export default memo(BucketPillInner, (prev, next) => {
  return (
    prev.variant === next.variant &&
    prev.active === next.active &&
    prev.market.id === next.market.id &&
    prev.market.deadline === next.market.deadline &&
    prev.market.resolution === next.market.resolution
  );
});
