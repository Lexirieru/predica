import { Router, Request, Response } from "express";
import { marketRepo, voteRepo, userRepo } from "../db/dal";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "../lib/websocket";
import { authMiddleware } from "../lib/middleware";

const router = Router();

// POST /api/vote — atomic: debit balance, insert vote, update pool, upsert user stats
router.post("/", authMiddleware("VOTE"), async (req: Request, res: Response) => {
  try {
    const { marketId, userWallet, side, amount } = req.body;
    const amountNum = parseFloat(amount);

    if (!marketId || !userWallet || !side || !(amountNum > 0)) {
      res.status(400).json({ error: "Invalid vote payload" });
      return;
    }
    if (side !== "yes" && side !== "no") {
      res.status(400).json({ error: "side must be 'yes' or 'no'" });
      return;
    }

    const market = await marketRepo.getById(marketId);
    if (!market || market.status !== "active") {
      res.status(400).json({ error: "Market not found or not active" });
      return;
    }
    if (market.deadline <= Date.now()) {
      res.status(400).json({ error: "Market already expired" });
      return;
    }

    // Atomic section: debit + vote + pool + user stats commit together.
    // If debit fails (insufficient balance), the whole transaction aborts.
    let vote;
    try {
      vote = await db.transaction(async (tx) => {
        const debited = await userRepo.tryDebit(tx, userWallet, amountNum);
        if (!debited) throw new Error("INSUFFICIENT_BALANCE");
        return await voteRepo.create(tx, { marketId, userWallet, side, amount: amountNum });
      });
    } catch (err: any) {
      if (err?.message === "INSUFFICIENT_BALANCE") {
        res.status(400).json({ error: "Insufficient balance" });
        return;
      }
      throw err;
    }

    broadcast("NEW_VOTE", { marketId, side, amount: amountNum, wallet: userWallet });

    const updated = await db.query.users.findFirst({ where: eq(users.wallet, userWallet) });
    res.status(201).json({ ...vote, balance: updated?.balance ?? 0 });
  } catch (err) {
    console.error("[Vote] Error:", err);
    res.status(500).json({ error: "Vote failed" });
  }
});

// GET /api/vote/user/:wallet
router.get("/user/:wallet", async (req: Request, res: Response) => {
  try {
    res.json(await voteRepo.getByUser(req.params.wallet));
  } catch {
    res.status(500).json({ error: "Failed to fetch votes" });
  }
});

export default router;
