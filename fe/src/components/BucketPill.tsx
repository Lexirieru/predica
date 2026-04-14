"use client";

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

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function BucketPill({ market, variant, onClick, active }: Props) {
  const now = useNow(30_000);
  const endLabel = formatTime(market.deadline);

  if (variant === "live") {
    return (
      <button
        onClick={onClick}
        className="relative shrink-0 px-3 py-1.5 rounded-lg border-2 border-[#dc3246] bg-[#dc3246]/10 text-left min-w-[88px]"
      >
        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#dc3246] opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#dc3246]" />
        </span>
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#dc3246]">Live</p>
        <p className="text-[11px] font-bold text-white tabular-nums">{endLabel}</p>
      </button>
    );
  }

  if (variant === "past") {
    const won = market.resolution === "yes";
    const baseBorder = won ? "border-[#00b482]/25 bg-[#00b482]/5" : "border-[#dc3246]/25 bg-[#dc3246]/5";
    const activeBorder = won
      ? "border-[#00b482] bg-[#00b482]/15 ring-1 ring-[#00b482]/40"
      : "border-[#dc3246] bg-[#dc3246]/15 ring-1 ring-[#dc3246]/40";
    return (
      <button
        onClick={onClick}
        className={`shrink-0 px-3 py-1.5 rounded-lg border text-left min-w-[88px] transition-all ${
          active ? activeBorder : baseBorder
        } hover:brightness-125`}
      >
        <p className={`text-[9px] font-bold uppercase tracking-widest ${won ? "text-[#00b482]" : "text-[#dc3246]"}`}>
          {won ? "▲ Up" : "▼ Down"}
        </p>
        <p className="text-[11px] text-white/60 tabular-nums">{endLabel}</p>
      </button>
    );
  }

  // upcoming
  const opensIn = market.deadline - 5 * 60 * 1000 - now;
  const opensInMin = Math.max(0, Math.round(opensIn / 60000));
  return (
    <button
      onClick={onClick}
      className="shrink-0 px-3 py-1.5 rounded-lg border border-dashed border-white/15 bg-transparent text-left min-w-[88px]"
    >
      <p className="text-[9px] font-bold uppercase tracking-widest text-white/30">
        {opensInMin > 0 ? `In ${opensInMin}m` : "Opening"}
      </p>
      <p className="text-[11px] text-white/40 tabular-nums">{endLabel}</p>
    </button>
  );
}
