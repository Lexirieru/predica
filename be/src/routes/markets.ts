import { Router, Request, Response } from "express";
import { marketRepo, voteRepo } from "../db/dal";
import * as pacifica from "../lib/pacifica";

const router = Router();

// GET /api/markets — active markets with live prices
router.get("/", async (_req: Request, res: Response) => {
  try {
    const markets = await marketRepo.getActive();

    // Try to enrich with live Pacifica prices
    try {
      const priceData = await pacifica.getPrices();
      if (priceData?.data && Array.isArray(priceData.data)) {
        for (const m of markets as any) {
          const p = priceData.data.find(
            (d: any) => d.symbol.toUpperCase() === m.symbol.toUpperCase(),
          );
          if (p?.mark) m.currentPrice = parseFloat(p.mark);
        }
      }
    } catch {
      // Pacifica API unavailable — use cached prices
    }

    res.json(markets);
  } catch (err) {
    console.error("[Markets] Error:", err);
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// GET /api/markets/all — all markets including resolved
router.get("/all", async (_req: Request, res: Response) => {
  try {
    res.json(await getAllMarkets());
  } catch {
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// GET /api/markets/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const market = await marketRepo.getById(req.params.id);
    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }
    const votes = await voteRepo.getByMarket(req.params.id);
    res.json({ ...market, votes });
  } catch {
    res.status(500).json({ error: "Failed to fetch market" });
  }
});

// POST /api/markets — create a new prediction market
router.post("/", async (req: Request, res: Response) => {
  try {
    const market = await marketRepo.create(req.body);
    res.status(201).json(market);
  } catch {
    res.status(500).json({ error: "Failed to create market" });
  }
});

export default router;
