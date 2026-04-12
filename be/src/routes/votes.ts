import { Router, Request, Response } from "express";
import { createVote, getVotesByUser } from "../db/votes";
import { getMarketById } from "../db/markets";
import { getDb } from "../db/schema";

const router = Router();

// POST /api/vote — deduct from internal balance, add to pool
router.post("/", (req: Request, res: Response) => {
  try {
    const { marketId, userWallet, side, amount } = req.body;

    if (!marketId || !userWallet || !side || !amount) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    if (side !== "yes" && side !== "no") {
      res.status(400).json({ error: "side must be 'yes' or 'no'" });
      return;
    }

    const amountNum = parseFloat(amount);
    if (amountNum <= 0) {
      res.status(400).json({ error: "Amount must be positive" });
      return;
    }

    const market = getMarketById(marketId);
    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }

    if (market.status !== "active") {
      res.status(400).json({ error: "Market is not active" });
      return;
    }

    if (market.deadline < Date.now()) {
      res.status(400).json({ error: "Market has expired" });
      return;
    }

    // Check internal balance
    const db = getDb();
    const user = db.prepare("SELECT balance FROM users WHERE wallet = ?").get(userWallet) as { balance: number } | undefined;

    if (!user || user.balance < amountNum) {
      res.status(400).json({ error: `Insufficient balance. You have $${(user?.balance || 0).toFixed(2)} USDP. Deposit more first.` });
      return;
    }

    // Deduct balance
    db.prepare("UPDATE users SET balance = balance - ? WHERE wallet = ?").run(amountNum, userWallet);

    // Create vote (adds to pool + user stats)
    const vote = createVote({ marketId, userWallet, side, amount: amountNum });

    const updated = db.prepare("SELECT balance FROM users WHERE wallet = ?").get(userWallet) as { balance: number };

    res.status(201).json({ ...vote, balance: updated.balance });
  } catch (err) {
    console.error("[Vote] Error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/vote/user/:wallet
router.get("/user/:wallet", (req: Request, res: Response) => {
  try {
    res.json(getVotesByUser(req.params.wallet));
  } catch {
    res.status(500).json({ error: "Failed to fetch votes" });
  }
});

export default router;
