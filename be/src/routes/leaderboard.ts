import { Router, Request, Response } from "express";
import { userRepo } from "../db/dal";

const router = Router();

// Cache leaderboard in memory for 5 minutes. High-traffic events (Hackathons)
// often result in leaderboard spamming. Background crons handle resolution
// so the board only changes significantly every few minutes anyway.
let cachedBoard: any = null;
let lastCacheUpdate = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000;

// GET /api/leaderboard
router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const now = Date.now();

    if (cachedBoard && now - lastCacheUpdate < CACHE_DURATION_MS) {
      // For simplicity, we cache a standard limit. If user asks for more,
      // we might hit DB, but usually FE asks for 20.
      if (limit <= 20) {
        res.json(cachedBoard);
        return;
      }
    }

    const board = await userRepo.getLeaderboard(Math.min(limit, 100));
    
    if (limit <= 20) {
      cachedBoard = board;
      lastCacheUpdate = now;
    }
    
    res.json(board);
  } catch {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

export default router;
