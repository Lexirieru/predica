/**
 * Measures real-time update cadence from Pacifica WS streams.
 *
 * This is an INTEGRATION test — it hits the Pacifica testnet WS.
 * Skip it in CI without network: `RUN_INTEGRATION=0 bun test`.
 *
 * Answers: "berapa ms antar update harga / candle?"
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import {
  startPacificaWs,
  stopPacificaWs,
  onPrices,
  onCandle,
  syncCandleSubscriptions,
  type PriceTick,
  type CandleTick,
} from "../../src/lib/pacificaWs";

const runIntegration = process.env.RUN_INTEGRATION !== "0";
const describeIf = runIntegration ? describe : describe.skip;

function stats(intervals: number[]) {
  if (intervals.length === 0) return { count: 0, min: 0, max: 0, avg: 0, median: 0 };
  const sorted = [...intervals].sort((a, b) => a - b);
  const sum = intervals.reduce((s, n) => s + n, 0);
  return {
    count: intervals.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / intervals.length),
    median: sorted[Math.floor(sorted.length / 2)],
  };
}

describeIf("Pacifica realtime stream cadence", () => {
  afterEach(() => {
    stopPacificaWs();
  });

  it(
    "prices stream pushes at least once per 5s (typical sub-second)",
    async () => {
      const timestamps: number[] = [];

      onPrices((_ticks: PriceTick[]) => {
        timestamps.push(Date.now());
      });

      startPacificaWs();

      // Collect for 15 seconds
      await new Promise((r) => setTimeout(r, 15_000));

      // Compute intervals between consecutive messages
      const intervals: number[] = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1]);
      }

      const s = stats(intervals);
      console.log("[prices] cadence stats (ms):", s);

      expect(timestamps.length).toBeGreaterThan(1);
      // Max gap < 5s — if exceeded, stream is stale or disconnected
      expect(s.max).toBeLessThan(5_000);
      // Typical avg sub-second on active testnet
      expect(s.avg).toBeLessThan(3_000);
    },
    30_000,
  );

  it(
    "mark_price_candle pushes OHLC updates as candle forms",
    async () => {
      const perSymbol: Record<string, number[]> = {};
      const sampleCandles: CandleTick[] = [];

      onCandle((tick: CandleTick) => {
        const sym = tick.symbol.toUpperCase();
        if (!perSymbol[sym]) perSymbol[sym] = [];
        perSymbol[sym].push(Date.now());
        if (sampleCandles.length < 3) sampleCandles.push(tick);
      });

      startPacificaWs();
      // Wait for connection to open before subscribing
      await new Promise((r) => setTimeout(r, 500));
      syncCandleSubscriptions(["BTC", "SOL", "ETH"]);

      // Collect for 15 seconds
      await new Promise((r) => setTimeout(r, 15_000));

      const allIntervals: number[] = [];
      for (const sym of Object.keys(perSymbol)) {
        const ts = perSymbol[sym];
        for (let i = 1; i < ts.length; i++) {
          allIntervals.push(ts[i] - ts[i - 1]);
        }
      }

      const s = stats(allIntervals);
      console.log("[candle] cadence stats (ms):", s);
      console.log(
        "[candle] per-symbol update counts:",
        Object.fromEntries(Object.entries(perSymbol).map(([k, v]) => [k, v.length])),
      );
      if (sampleCandles[0]) {
        console.log("[candle] sample tick:", sampleCandles[0]);
      }

      // At least one of BTC/SOL/ETH should produce multiple ticks in 15s
      expect(Object.keys(perSymbol).length).toBeGreaterThan(0);
      // OHLC fields present
      if (sampleCandles[0]) {
        expect(sampleCandles[0].open).toBeDefined();
        expect(sampleCandles[0].close).toBeDefined();
        expect(sampleCandles[0].high).toBeDefined();
        expect(sampleCandles[0].low).toBeDefined();
      }
    },
    30_000,
  );
});
