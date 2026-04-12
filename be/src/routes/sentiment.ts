import { Router, Request, Response } from "express";
import * as elfa from "../lib/elfa";

const router = Router();

// GET /api/sentiment/:symbol — social sentiment from Elfa
router.get("/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const mentions = await elfa.getTopMentions(symbol);
    const data = mentions?.data || [];

    // Calculate simple sentiment from engagement
    let totalEngagement = 0;
    let positiveSignals = 0;

    for (const m of data.slice(0, 20)) {
      const engagement = (m.likeCount || 0) + (m.repostCount || 0) * 2;
      totalEngagement += engagement;
      if (engagement > 100) positiveSignals++;
    }

    const mentionCount = data.length;
    const bullishPercent = mentionCount > 0
      ? Math.round((positiveSignals / Math.min(mentionCount, 20)) * 100)
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
