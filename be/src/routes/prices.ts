import { Router, Request, Response } from "express";
import * as pacifica from "../lib/pacifica";
import { getCandles, loadCandlesFromDb } from "../lib/candleCache";

const router = Router();

// GET /api/prices — live prices from Pacifica
router.get("/", async (_req: Request, res: Response) => {
  try {
    const prices = await pacifica.getPrices();
    res.json(prices);
  } catch {
    res.status(502).json({ error: "Failed to fetch prices from Pacifica" });
  }
});

// GET /api/prices/kline/:symbol — candle data
router.get("/kline/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol);
    const interval = (req.query.interval as string) || "1h";
    const endTime = Date.now();
    const startTime = endTime - 24 * 60 * 60 * 1000; // last 24h

    const kline = await pacifica.getKline(symbol, interval, startTime, endTime);
    res.json(kline);
  } catch {
    res.status(502).json({ error: "Failed to fetch kline data" });
  }
});

// GET /api/prices/candles/:symbol?window=1h|2h|6h|24h
// Multi-tier candle source:
//   1. Hot cache (last 60 × 1m) — hit for recently-active symbols.
//   2. DB candle_snapshots — persists across BE restarts; up to 2 days.
//   3. Pacifica REST /kline — last-resort for symbols we've never streamed.
const WINDOW_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

router.get("/candles/:symbol", async (req: Request, res: Response) => {
  try {
    const sym = String(req.params.symbol).toUpperCase();
    const windowKey = (req.query.window as string) || "1h";
    const windowMs = WINDOW_MS[windowKey] ?? WINDOW_MS["1h"];

    const cached = getCandles(sym);

    // If cache covers the requested window entirely, serve from cache.
    const cacheCoversWindow =
      cached.length > 0 && cached[0].openTime <= Date.now() - windowMs + 60_000;

    if (cacheCoversWindow) {
      res.json({
        source: "cache",
        interval: "1m",
        window: windowKey,
        data: cached.map((c) => ({
          t: c.openTime,
          T: c.closeTime,
          o: parseFloat(c.open),
          c: parseFloat(c.close),
          h: parseFloat(c.high),
          l: parseFloat(c.low),
          v: parseFloat(c.volume),
          n: c.trades,
        })),
      });
      return;
    }

    // DB layer.
    const dbRows = await loadCandlesFromDb(sym, windowMs);
    if (dbRows.length > 0) {
      res.json({
        source: "db",
        interval: "1m",
        window: windowKey,
        data: dbRows.map((c) => ({
          t: c.openTime,
          T: c.closeTime,
          o: parseFloat(c.open),
          c: parseFloat(c.close),
          h: parseFloat(c.high),
          l: parseFloat(c.low),
          v: parseFloat(c.volume),
          n: c.trades,
        })),
      });
      return;
    }

    // Last resort: Pacifica REST.
    const endTime = Date.now();
    const startTime = endTime - windowMs;
    const kline = await pacifica.getKline(sym, "1m", startTime, endTime);
    res.json({
      source: "rest",
      interval: "1m",
      window: windowKey,
      data: kline?.data ?? [],
    });
  } catch {
    res.status(502).json({ error: "Failed to fetch candles" });
  }
});

// GET /api/prices/book/:symbol — orderbook
router.get("/book/:symbol", async (req: Request, res: Response) => {
  try {
    const data = await pacifica.getOrderbook(String(req.params.symbol));
    res.json(data);
  } catch {
    res.status(502).json({ error: "Failed to fetch orderbook" });
  }
});

// GET /api/prices/info — market info (symbols, tick sizes, leverage)
router.get("/info", async (_req: Request, res: Response) => {
  try {
    const info = await pacifica.getMarketInfo();
    res.json(info);
  } catch {
    res.status(502).json({ error: "Failed to fetch market info" });
  }
});

export default router;
