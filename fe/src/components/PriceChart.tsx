"use client";

import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type LineData, type Time, ColorType, LineSeries } from "lightweight-charts";
import type { Candle } from "@/lib/types";

interface Props {
  candles: Candle[];
  currentPrice: number;
  targetPrice?: number;
  isPositive: boolean;
  /** When true, chart ignores live currentPrice updates (historical freeze). */
  frozen?: boolean;
  /** Settlement price marker — rendered as a colored price line above target. */
  settlementPrice?: number;
  /** True = settled YES (settlement price above target). Colors the marker. */
  settledPositive?: boolean;
}

export default function PriceChart({
  candles,
  currentPrice,
  targetPrice,
  frozen,
  settlementPrice,
  settledPositive,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLineRef = useRef<ReturnType<ISeriesApi<"Line">["createPriceLine"]> | null>(null);
  const settlementLineRef = useRef<ReturnType<ISeriesApi<"Line">["createPriceLine"]> | null>(null);
  const initializedRef = useRef(false);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.2)",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 3,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        horzLine: { visible: false },
        vertLine: { color: "rgba(255,255,255,0.1)", width: 1, style: 3 },
      },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addSeries(LineSeries, {
      color: "#F0A500",
      lineWidth: 2,
      lineType: 0,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: "#F0A500",
      lastValueVisible: true,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    initializedRef.current = false;

    // On every width change, re-apply width AND re-fit content. Without the
    // fitContent call, a chart that was created while its container was still
    // mid-layout (e.g. remounted during a card transition) gets stuck with
    // the Y-scale computed against the transient size. That's what caused
    // "chart feels zoomed after navigating between past buckets and back to
    // live" — the new chart instance inherited a cramped visible range from
    // its first measurement. handleScale/handleScroll are both false so
    // re-fitting on resize doesn't fight user interaction.
    const observer = new ResizeObserver(() => {
      const c = chartRef.current;
      const el = containerRef.current;
      if (!c || !el) return;
      c.applyOptions({ width: el.clientWidth });
      c.timeScale().fitContent();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initializedRef.current = false;
    };
  }, []);

  // Seed historical candle data once
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0 || initializedRef.current) return;

    const seen = new Map<number, number>();
    for (const c of candles) {
      if (c.close > 0) seen.set(c.time, c.close);
    }
    const data: LineData<Time>[] = Array.from(seen.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, v]) => ({ time: t as Time, value: v }));

    if (data.length === 0) {
      // No valid candle data yet, but mark initialized so realtime ticks can start
      initializedRef.current = true;
      return;
    }
    seriesRef.current.setData(data);
    initializedRef.current = true;

    // Target price line
    if (priceLineRef.current) {
      seriesRef.current.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    if (targetPrice && targetPrice > 0) {
      priceLineRef.current = seriesRef.current.createPriceLine({
        price: targetPrice,
        color: "rgba(255,255,255,0.15)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Target",
      });
    }

    // Settlement marker — only rendered in frozen (historical) mode.
    if (settlementLineRef.current) {
      seriesRef.current.removePriceLine(settlementLineRef.current);
      settlementLineRef.current = null;
    }
    if (frozen && settlementPrice && settlementPrice > 0) {
      settlementLineRef.current = seriesRef.current.createPriceLine({
        price: settlementPrice,
        color: settledPositive ? "#00b482" : "#dc3246",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "Settled",
      });
    }

    // Defer fitContent to the next frame so the container has committed its
    // final width before we compute the visible range. Calling it
    // synchronously during a remount mid-animation produces a Y-scale fit
    // against a 0-width / pre-layout measurement, which then sticks.
    const rafId = requestAnimationFrame(() => {
      chartRef.current?.timeScale().fitContent();
    });
    return () => cancelAnimationFrame(rafId);
  }, [candles, targetPrice, frozen, settlementPrice, settledPositive]);

  // Realtime tick update — only runs in live mode. Frozen (historical) mode
  // skips these so the chart stays pinned to the selected bucket's candles.
  useEffect(() => {
    if (frozen) return;
    if (!seriesRef.current || !initializedRef.current || !currentPrice || currentPrice <= 0) return;

    const now = Math.floor(Date.now() / 1000);
    seriesRef.current.update({
      time: now as Time,
      value: currentPrice,
    });
  }, [currentPrice, frozen]);

  return (
    <div ref={containerRef} className="w-full h-full [&_a[href*='tradingview']]:!hidden" />
  );
}
