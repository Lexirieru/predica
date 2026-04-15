import { Router, Request, Response } from "express";
import { z } from "zod";
import { marketRepo, voteRepo, userRepo } from "../db/dal";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "../lib/websocket";
import { authMiddleware } from "../lib/middleware";
import { computeShareWeight } from "../lib/payoutWeight";

const router = Router();

const MAX_VOTE_AMOUNT = 1_000_000; // $1M cap per vote
const MIN_VOTE_AMOUNT = 0.01;

const VoteSchema = z.object({
  marketId: z.string().min(1),
  userWallet: z.string().min(20).max(64),
  side: z.enum(["yes", "no"]),
  amount: z.coerce
    .number()
    .positive()
    .finite()
    .min(MIN_VOTE_AMOUNT, `Minimum vote ${MIN_VOTE_AMOUNT}`)
    .max(MAX_VOTE_AMOUNT, `Maximum vote ${MAX_VOTE_AMOUNT}`),
});

// POST /api/vote — atomic: debit balance, insert vote, update pool, upsert user stats
router.post("/", authMiddleware("VOTE"), async (req: Request, res: Response) => {
  const parsed = VoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid vote payload", details: parsed.error.issues });
    return;
  }
  const { marketId, userWallet, side, amount: amountNum } = parsed.data;

  try {

    const market = await marketRepo.getById(marketId);
    if (!market || market.status !== "active") {
      res.status(400).json({ error: "Market not found or not active" });
      return;
    }
    if (market.deadline <= Date.now()) {
      res.status(400).json({ error: "Market already expired" });
      return;
    }

    // Hybrid anti-late-bet: compute share weight from pool state BEFORE this
    // bet is added. The snapshot read above is good enough — a concurrent
    // vote landing in the tiny race window doesn't change the math materially
    // (at most shifts p by one-bet-worth of pool). See payoutWeight.ts.
    const targetPoolBefore = side === "yes" ? market.yesPool : market.noPool;
    const oppositePoolBefore = side === "yes" ? market.noPool : market.yesPool;
    const shareWeight = computeShareWeight({
      targetPoolBefore,
      oppositePoolBefore,
      deadline: Number(market.deadline),
      now: Date.now(),
      durationMin: market.durationMin ?? 5,
    });

    // Atomic section: debit + vote + pool + user stats commit together.
    // If debit fails (insufficient balance), the whole transaction aborts.
    let vote;
    try {
      vote = await db.transaction(async (tx) => {
        const debited = await userRepo.tryDebit(tx, userWallet, amountNum);
        if (!debited) throw new Error("INSUFFICIENT_BALANCE");
        return await voteRepo.create(tx, { marketId, userWallet, side, amount: amountNum, shareWeight });
      });
    } catch (err: any) {
      if (err?.message === "INSUFFICIENT_BALANCE") {
        res.status(400).json({ error: "Insufficient balance" });
        return;
      }
      throw err;
    }

    broadcast("NEW_VOTE", { marketId, side, amount: amountNum, wallet: userWallet, shareWeight });

    const updated = await db.query.users.findFirst({ where: eq(users.wallet, userWallet) });
    // shareWeight surfaces to FE so it can render "your bet counts as 0.7x"
    // warning in the trade confirm UI and the portfolio vote list.
    res.status(201).json({ ...vote, balance: updated?.balance ?? 0, shareWeight });
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
