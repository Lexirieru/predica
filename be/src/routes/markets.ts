import { Router, Request, Response } from "express";
import { getActiveMarkets, getAllMarkets, getMarketById, createMarket } from "../db/markets";
import { getVotesByMarket } from "../db/votes";
import * as pacifica from "../lib/pacifica";

const router = Router();

// GET /api/markets — active markets with live prices
router.get("/", async (_req: Request, res: Response) => {
  try {
    const markets = getActiveMarkets();

    // Try to enrich with live Pacifica prices
    try {
      const priceData = await pacifica.getPrices();
      if (priceData && typeof priceData === "object") {
        for (const m of markets) {
          const symbolPrices = priceData[m.symbol];
          if (symbolPrices?.mark_price) {
            m.current_price = parseFloat(symbolPrices.mark_price);
          }
        }
      }
    } catch {
      // Pacifica API unavailable — use cached prices
    }

    res.json(markets);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// GET /api/markets/all — all markets including resolved
router.get("/all", (_req: Request, res: Response) => {
  try {
    res.json(getAllMarkets());
  } catch {
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// GET /api/markets/:id
router.get("/:id", (req: Request, res: Response) => {
  try {
    const market = getMarketById(req.params.id);
    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }
    const votes = getVotesByMarket(req.params.id);
    res.json({ ...market, votes });
  } catch {
    res.status(500).json({ error: "Failed to fetch market" });
  }
});

// POST /api/markets — create a new prediction market
router.post("/", (req: Request, res: Response) => {
  try {
    const { symbol, question, targetPrice, currentPrice, deadline, category, sentiment } = req.body;

    if (!symbol || !question || !targetPrice || !deadline) {
      res.status(400).json({ error: "Missing required fields: symbol, question, targetPrice, deadline" });
      return;
    }

    const market = createMarket({
      symbol,
      question,
      targetPrice,
      currentPrice: currentPrice || 0,
      deadline,
      category: category || "crypto",
      sentiment,
    });

    res.status(201).json(market);
  } catch {
    res.status(500).json({ error: "Failed to create market" });
  }
});

export default router;
