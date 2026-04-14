import { Router, Request, Response } from "express";
import * as elfa from "../lib/elfa";

const router = Router();

// GET /api/sentiment/:symbol — social sentiment from Elfa
router.get("/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const mentions = await elfa.getTopMentions(symbol);
    const data = mentions?.data || [];

    // Weighted sentiment: each mention contributes a partial signal (0..1)
    // based on engagement, saturating at ENGAGEMENT_SATURATION so a few viral
    // posts don't dominate. This adapts to both high-volume mainnet and
    // low-engagement testnet instead of a fixed "> 100" threshold.
    const ENGAGEMENT_SATURATION = 10;
    const sample = data.slice(0, 20);

    let weightedScore = 0;
    for (const m of sample) {
      const engagement = (m.likeCount || 0) + (m.repostCount || 0) * 2;
      weightedScore += Math.min(1, engagement / ENGAGEMENT_SATURATION);
    }

    const mentionCount = data.length;
    const bullishPercent = sample.length > 0
      ? Math.round((weightedScore / sample.length) * 100)
      : 50;

    res.json({
      symbol: symbol.toUpperCase(),
      mentionCount,
      bullishPercent,
      topMentions: data.slice(0, 5).map((m: Record<string, unknown>) => ({
        link: m.link,
        likes: m.likeCount,
        reposts: m.repostCount,
        views: m.viewCount,
      })),
    });
  } catch {
    res.status(502).json({ error: "Failed to fetch sentiment data" });
  }
});

// GET /api/sentiment — trending tokens
router.get("/", async (_req: Request, res: Response) => {
  try {
    const trending = await elfa.getTrendingTokens("24h");
    res.json(trending);
  } catch {
    res.status(502).json({ error: "Failed to fetch trending data" });
  }
});

export default router;
