import { Router, Request, Response } from "express";
import * as pacifica from "../lib/pacifica";
import { getCandles } from "../lib/candleCache";

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
    const { symbol } = req.params;
    const interval = (req.query.interval as string) || "1h";
    const endTime = Date.now();
    const startTime = endTime - 24 * 60 * 60 * 1000; // last 24h

    const kline = await pacifica.getKline(symbol, interval, startTime, endTime);
    res.json(kline);
  } catch {
    res.status(502).json({ error: "Failed to fetch kline data" });
  }
});

// GET /api/prices/candles/:symbol — in-memory 1m candle cache (WS-fed)
// Returns OHLC array for initial chart seed. Falls back to Pacifica REST
// /kline when cache is empty (e.g. market just created, no tick yet).
router.get("/candles/:symbol", async (req: Request, res: Response) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    const cached = getCandles(sym);

    if (cached.length > 0) {
      res.json({
        source: "cache",
        interval: "1m",
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

    // Fallback: REST /kline last 60 minutes, 1m interval
    const endTime = Date.now();
    const startTime = endTime - 60 * 60 * 1000;
    const kline = await pacifica.getKline(sym, "1m", startTime, endTime);
    res.json({ source: "rest", interval: "1m", data: kline?.data ?? [] });
  } catch {
    res.status(502).json({ error: "Failed to fetch candles" });
  }
});

// GET /api/prices/book/:symbol — orderbook
router.get("/book/:symbol", async (req: Request, res: Response) => {
  try {
    const data = await pacifica.getOrderbook(req.params.symbol);
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
