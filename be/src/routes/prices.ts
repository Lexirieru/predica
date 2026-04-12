import { Router, Request, Response } from "express";
import * as pacifica from "../lib/pacifica";

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
