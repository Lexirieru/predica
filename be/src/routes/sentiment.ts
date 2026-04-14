import { Router, Request, Response } from "express";
import * as elfa from "../lib/elfa";
import { getSentiment } from "../lib/sentimentCache";

const router = Router();

// GET /api/sentiment/:symbol — LLM-backed sentiment with stale-while-revalidate.
// First call returns fast engagement-proxy (~500ms), subsequent calls hit cache.
// Elfa chat LLM analysis runs in the background and upgrades the cached answer.
router.get("/:symbol", async (req: Request, res: Response) => {
  try {
    const result = await getSentiment(req.params.symbol);
    res.json(result);
  } catch (err) {
    console.error("[Sentiment] Error:", err);
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
