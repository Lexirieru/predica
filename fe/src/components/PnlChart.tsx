"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  ColorType,
  AreaSeries,
} from "lightweight-charts";
import { useNow } from "@/hooks/useNow";

export type PnlRange = "day" | "week" | "month" | "all";

interface VoteLike {
  createdAt: number;
  amount: number;
  payout: number;
  status: string;
}

interface Props {
  votes: VoteLike[];
}

const RANGE_MS: Record<PnlRange, number | null> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all: null,
};

function pnlDelta(v: VoteLike): number {
  if (v.status === "won") return v.payout - v.amount;
  if (v.status === "lost") return -v.amount;
  return 0; // pending
}

export default function PnlChart({ votes }: Props) {
  const [range, setRange] = useState<PnlRange>("week");
  const now = useNow(60_000);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  // Build cumulative series filtered by range.
  const { series, summary } = useMemo(() => {
    const cutoff = RANGE_MS[range] ? now - (RANGE_MS[range] as number) : 0;
    const filtered = votes
      .filter((v) => v.status !== "pending" && v.createdAt >= cutoff)
      .sort((a, b) => a.createdAt - b.createdAt);

    // Immutable running sum — produce [point, runningTotal] per settled vote.
    const points: LineData<Time>[] = filtered.reduce<LineData<Time>[]>((acc, v) => {
      const prev = acc.length > 0 ? (acc[acc.length - 1].value as number) : 0;
      acc.push({
        time: Math.floor(v.createdAt / 1000) as Time,
        value: prev + pnlDelta(v),
      });
      return acc;
    }, []);

    // Prepend a zero baseline at the range start (or earliest vote).
    const seeded = points.length > 0
      ? [
          {
            time: Math.floor((cutoff > 0 ? cutoff : filtered[0].createdAt) / 1000) as Time,
            value: 0,
          },
          ...points,
        ]
      : points;

    const total = points.length > 0 ? (points[points.length - 1].value as number) : 0;
    return {
      series: seeded,
      summary: { total, count: filtered.length },
    };
  }, [votes, range, now]);

  // Chart lifecycle
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.3)",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.2, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: { visible: false },
        vertLine: { color: "rgba(255,255,255,0.15)", width: 1, style: 3 },
      },
      handleScale: false,
      handleScroll: false,
    });
    chartRef.current = chart;

    const obs = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    obs.observe(containerRef.current);

    return () => {
      obs.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Repaint series when data or color (positive/negative) changes.
  useEffect(() => {
    if (!chartRef.current) return;

    // Drop old series, create new (color depends on sign).
    if (seriesRef.current) {
      chartRef.current.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    if (series.length === 0) return;

    const positive = summary.total >= 0;
    const line = positive ? "#00b482" : "#dc3246";
    const top = positive ? "rgba(0, 180, 130, 0.35)" : "rgba(220, 50, 70, 0.35)";
    const bottom = positive ? "rgba(0, 180, 130, 0.0)" : "rgba(220, 50, 70, 0.0)";

    const s = chartRef.current.addSeries(AreaSeries, {
      lineColor: line,
      topColor: top,
      bottomColor: bottom,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    s.setData(series);
    chartRef.current.timeScale().fitContent();
    seriesRef.current = s;
  }, [series, summary.total]);

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 mb-4">
      {/* Header + range filter */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-widest">PnL {range === "all" ? "all-time" : range}</p>
          <p
            className={`text-xl font-bold tabular-nums ${summary.total >= 0 ? "text-[#00b482]" : "text-[#dc3246]"}`}
          >
            {summary.total >= 0 ? "+" : ""}${summary.total.toFixed(2)}
          </p>
          <p className="text-white/20 text-[10px]">{summary.count} settled</p>
        </div>

        <div className="flex gap-1">
          {(["day", "week", "month", "all"] as PnlRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                range === r ? "bg-white/10 text-white" : "text-white/30 hover:text-white/60"
              }`}
            >
              {r === "day" ? "1D" : r === "week" ? "1W" : r === "month" ? "1M" : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-36 relative">
        {series.length < 2 ? (
          <div className="absolute inset-0 flex items-center justify-center text-white/20 text-xs">
            Not enough settled votes in this range
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-full [&_a[href*='tradingview']]:!hidden" />
        )}
      </div>
    </div>
  );
}
