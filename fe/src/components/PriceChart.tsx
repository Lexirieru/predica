"use client";

import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type LineData, type Time, ColorType, LineSeries } from "lightweight-charts";
import type { Candle } from "@/lib/types";

interface Props {
  candles: Candle[];
  currentPrice: number;
  targetPrice?: number;
  isPositive: boolean;
}

export default function PriceChart({ candles, currentPrice, targetPrice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLineRef = useRef<ReturnType<ISeriesApi<"Line">["createPriceLine"]> | null>(null);
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

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
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

    chartRef.current?.timeScale().fitContent();
  }, [candles, targetPrice]);

  // Realtime tick update — called every 50-75ms via PRICE_UPDATE
  useEffect(() => {
    if (!seriesRef.current || !initializedRef.current || !currentPrice || currentPrice <= 0) return;

    const now = Math.floor(Date.now() / 1000);
    seriesRef.current.update({
      time: now as Time,
      value: currentPrice,
    });
  }, [currentPrice]);

  return (
    <div ref={containerRef} className="w-full h-full [&_a[href*='tradingview']]:!hidden" />
  );
}
