import { Router, Request, Response } from "express";
import { getLeaderboard } from "../db/votes";

const router = Router();

// GET /api/leaderboard
router.get("/", (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const board = getLeaderboard(Math.min(limit, 100));
    res.json(board);
  } catch {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

export default router;
