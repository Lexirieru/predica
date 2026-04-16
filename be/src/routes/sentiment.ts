import { Router, Request, Response } from "express";
import { z } from "zod";
import * as elfa from "../lib/elfa";
import { getSentiment } from "../lib/sentimentCache";

const router = Router();

// Symbols are 2-20 uppercase alphanumerics (BTC, kPEPE, SOL-USDC, etc).
// Reject anything else to keep user input out of API URLs and cache keys.
const SymbolSchema = z.string().min(1).max(20).regex(/^[A-Za-z0-9-]+$/);

// GET /api/sentiment — trending tokens. MUST be defined before /:symbol
// or Express matches "sentiment/" as symbol="" and 400s out.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const trending = await elfa.getTrendingTokens("24h");
    res.json(trending);
  } catch {
    res.status(502).json({ error: "Failed to fetch trending data" });
  }
});

// GET /api/sentiment/:symbol — LLM-backed sentiment with stale-while-revalidate.
router.get("/:symbol", async (req: Request, res: Response) => {
  const parsed = SymbolSchema.safeParse(req.params.symbol);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }
  try {
    const result = await getSentiment(parsed.data);
    res.json(result);
  } catch (err) {
    console.error("[Sentiment] Error:", err);
    res.status(502).json({ error: "Failed to fetch sentiment data" });
  }
});

export default router;
