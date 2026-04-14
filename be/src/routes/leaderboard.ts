import { Router, Request, Response } from "express";
import { userRepo } from "../db/dal";

const router = Router();

// GET /api/leaderboard
router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const board = await userRepo.getLeaderboard(Math.min(limit, 100));
    res.json(board);
  } catch {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

export default router;
