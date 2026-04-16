import { Router, Request, Response } from "express";
import { listAchievements, BADGE_LIST } from "../lib/achievements";

const router = Router();

// GET /api/achievements — catalog of all possible badges (FE renders locked + unlocked states).
router.get("/", (_req: Request, res: Response) => {
  res.json({ badges: BADGE_LIST });
});

// GET /api/achievements/:wallet — badges this wallet has unlocked.
router.get("/:wallet", async (req: Request, res: Response) => {
  try {
    const wallet = String(req.params.wallet);
    if (!wallet || wallet.length < 20 || wallet.length > 64) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }
    const rows = await listAchievements(wallet);
    res.json({ wallet, unlocked: rows });
  } catch (err) {
    console.error("[Achievements] Error:", err);
    res.status(500).json({ error: "Failed to fetch achievements" });
  }
});

export default router;
