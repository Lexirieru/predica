import { Router, Request, Response } from "express";
import { z } from "zod";
import { marketRepo, voteRepo } from "../db/dal";
import * as pacifica from "../lib/pacifica";

const router = Router();

const CreateMarketSchema = z.object({
  symbol: z.string().min(1).max(20),
  question: z.string().min(5).max(500),
  targetPrice: z.number().positive().finite(),
  currentPrice: z.number().positive().finite().optional(),
  deadline: z.number().int().refine((v) => v > Date.now(), "deadline must be in the future"),
  category: z.string().max(40).optional(),
  sentiment: z.number().min(0).max(100).optional(),
});

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

// GET /api/markets/all — all markets including resolved (max 200)
router.get("/all", async (_req: Request, res: Response) => {
  try {
    res.json(await marketRepo.getAll());
  } catch (err) {
    console.error("[Markets/all] Error:", err);
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// GET /api/markets/symbol/:SYMBOL
// Timeline view for a single asset: past (resolved) + live + upcoming buckets.
// Designed for Polymarket-style symbol pages where the chart is continuous
// and the series of rounds shows below it.
router.get("/symbol/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol);
    if (!symbol || symbol.length > 20) {
      res.status(400).json({ error: "Invalid symbol" });
      return;
    }
    const pastLimit = Math.min(parseInt(req.query.past as string) || 12, 50);
    const series = await marketRepo.getSeries(symbol, pastLimit);
    res.json(series);
  } catch (err) {
    console.error("[Markets/series] Error:", err);
    res.status(500).json({ error: "Failed to fetch series" });
  }
});

// GET /api/markets/:id/hype — vote-ratio timeline (running yes/no pool over time).
// Powers the "hype meter" sparkline. Response structure is normalized so FE
// can pipe straight into a chart library.
router.get("/:id/hype", async (req: Request, res: Response) => {
  try {
    const market = await marketRepo.getById(String(req.params.id));
    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }
    const raw = await voteRepo.getHypeTimeline(market.id);

    // Normalize into yes-share fractions and pool snapshots.
    const timeline = raw.map((p) => {
      const total = p.yes + p.no;
      return {
        t: p.t,
        yesShare: total > 0 ? p.yes / total : 0.5,
        noShare:  total > 0 ? p.no  / total : 0.5,
        yesPool: p.yes,
        noPool: p.no,
        totalVotes: p.totalVotes,
      };
    });

    const current = {
      yesShare: (market.yesPool + market.noPool) > 0
        ? market.yesPool / (market.yesPool + market.noPool)
        : 0.5,
      noShare: (market.yesPool + market.noPool) > 0
        ? market.noPool / (market.yesPool + market.noPool)
        : 0.5,
      yesPool: market.yesPool,
      noPool: market.noPool,
      totalVoters: market.totalVoters,
    };

    res.json({
      marketId: market.id,
      symbol: market.symbol,
      status: market.status,
      current,
      timeline,
    });
  } catch (err) {
    console.error("[Markets/hype] Error:", err);
    res.status(500).json({ error: "Failed to fetch hype" });
  }
});

// GET /api/markets/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const market = await marketRepo.getById(String(req.params.id));
    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }
    const votes = await voteRepo.getByMarket(String(req.params.id));
    res.json({ ...market, votes });
  } catch {
    res.status(500).json({ error: "Failed to fetch market" });
  }
});

// POST /api/markets — create a new prediction market
router.post("/", async (req: Request, res: Response) => {
  const parsed = CreateMarketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }
  try {
    const market = await marketRepo.create(parsed.data);
    res.status(201).json(market);
  } catch (err) {
    console.error("[Markets/create] Error:", err);
    res.status(500).json({ error: "Failed to create market" });
  }
});

export default router;
