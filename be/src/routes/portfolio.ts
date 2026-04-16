import { Router, Request, Response } from "express";
import { userRepo } from "../db/dal";

const router = Router();

// GET /api/portfolio/:wallet/stats — aggregated PnL summary for profile header.
router.get("/:wallet/stats", async (req: Request, res: Response) => {
  try {
    const wallet = String(req.params.wallet);
    if (!wallet || wallet.length < 20 || wallet.length > 64) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }

    const stats = await userRepo.getPortfolioStats(wallet);
    if (!stats) {
      // User belum pernah vote / deposit → return zero-state so FE doesn't 404.
      res.json({
        wallet,
        balance: 0,
        totalVotes: 0,
        wins: 0,
        losses: 0,
        pending: 0,
        winRate: 0,
        totalWagered: 0,
        totalPnl: 0,
        roi: 0,
        avgBet: 0,
        biggestWin: 0,
        biggestLoss: 0,
        totalDeposits: 0,
        totalWithdrawals: 0,
      });
      return;
    }

    res.json(stats);
  } catch (err) {
    console.error("[Portfolio/stats] Error:", err);
    res.status(500).json({ error: "Failed to fetch portfolio stats" });
  }
});

export default router;
