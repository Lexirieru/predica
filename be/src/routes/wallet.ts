import { Router, Request, Response } from "express";
import { db } from "../db";
import { users, transactions } from "../db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { verifyDeposit, sendUsdp } from "../lib/solana";
import { authMiddleware } from "../lib/middleware";

const router = Router();

// In-process serialization per wallet to guard against double-click withdraw storms.
// (Defense-in-depth; DB-level conditional UPDATE is the real correctness guarantee.)
const withdrawLocks = new Set<string>();

// POST /api/wallet/deposit
router.post("/deposit", async (req: Request, res: Response) => {
  try {
    const { wallet, amount, txSignature } = req.body;
    const amountNum = parseFloat(amount);

    if (!wallet || !(amountNum > 0) || !txSignature) {
      res.status(400).json({ error: "Missing wallet, amount, or txSignature" });
      return;
    }

    // Short-circuit if signature already processed (fast path; UNIQUE index is the ultimate guard).
    const existing = await db.query.transactions.findFirst({
      where: eq(transactions.txSignature, txSignature),
    });
    if (existing) {
      res.status(400).json({ error: "Transaction already processed" });
      return;
    }

    const verified = await verifyDeposit(txSignature, amountNum, wallet);
    if (!verified) {
      res.status(400).json({ error: "Deposit not verified on-chain." });
      return;
    }

    const id = uuid();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(transactions).values({
          id,
          wallet,
          type: "deposit",
          amount: amountNum,
          txSignature,
          status: "confirmed",
        });
        await tx.insert(users)
          .values({ wallet, balance: amountNum, totalDeposits: amountNum })
          .onConflictDoUpdate({
            target: users.wallet,
            set: {
              balance: sql`${users.balance} + ${amountNum}`,
              totalDeposits: sql`${users.totalDeposits} + ${amountNum}`,
            },
          });
      });
    } catch (err: any) {
      // Unique violation on tx_signature => concurrent duplicate request.
      if (err?.code === "23505") {
        res.status(400).json({ error: "Transaction already processed" });
        return;
      }
      throw err;
    }

    const user = await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
    res.json({ success: true, balance: user?.balance ?? 0, txId: id });
  } catch (err) {
    console.error("[Deposit] Error:", err);
    res.status(500).json({ error: "Deposit failed" });
  }
});

// POST /api/wallet/withdraw
// Flow:
//   1. Atomic conditional debit + insert pending tx row.
//   2. Send USDP on-chain.
//   3. On success: mark tx confirmed + bump totalWithdrawals.
//   4. On failure: refund balance + mark tx failed.
router.post("/withdraw", authMiddleware("WITHDRAW"), async (req: Request, res: Response) => {
  const { wallet, amount } = req.body;
  const amountNum = parseFloat(amount);

  if (!wallet || !(amountNum > 0)) {
    res.status(400).json({ error: "Invalid withdraw payload" });
    return;
  }

  if (withdrawLocks.has(wallet)) {
    res.status(429).json({ error: "Withdrawal already in progress" });
    return;
  }
  withdrawLocks.add(wallet);

  const txId = uuid();
  let debited = false;

  try {
    // Step 1: Atomic debit + record pending tx in a single transaction.
    // If balance is insufficient, conditional update affects 0 rows -> abort.
    try {
      await db.transaction(async (tx) => {
        const updated = await tx.update(users)
          .set({ balance: sql`${users.balance} - ${amountNum}` })
          .where(and(eq(users.wallet, wallet), gte(users.balance, amountNum)))
          .returning({ wallet: users.wallet });

        if (updated.length === 0) throw new Error("INSUFFICIENT_BALANCE");
        debited = true;

        await tx.insert(transactions).values({
          id: txId,
          wallet,
          type: "withdraw",
          amount: amountNum,
          status: "pending",
        });
      });
    } catch (err: any) {
      if (err?.message === "INSUFFICIENT_BALANCE") {
        res.status(400).json({ error: "Insufficient balance" });
        return;
      }
      throw err;
    }

    // Step 2: On-chain transfer. Must happen after the debit is committed — not inside the tx,
    // since a long-running RPC call would hold DB locks.
    let signature: string;
    try {
      signature = await sendUsdp(wallet, amountNum);
    } catch (chainErr) {
      // Refund: reverse the debit and mark tx failed.
      console.error("[Withdraw] On-chain send failed, refunding:", chainErr);
      await db.transaction(async (tx) => {
        await tx.update(users)
          .set({ balance: sql`${users.balance} + ${amountNum}` })
          .where(eq(users.wallet, wallet));
        await tx.update(transactions)
          .set({ status: "failed", metadata: JSON.stringify({ error: String(chainErr) }) })
          .where(eq(transactions.id, txId));
      });
      res.status(502).json({ error: "On-chain transfer failed, balance refunded" });
      return;
    }

    // Step 3: Confirm tx and update withdrawal total.
    await db.transaction(async (tx) => {
      await tx.update(transactions)
        .set({ status: "confirmed", txSignature: signature })
        .where(eq(transactions.id, txId));
      await tx.update(users)
        .set({ totalWithdrawals: sql`${users.totalWithdrawals} + ${amountNum}` })
        .where(eq(users.wallet, wallet));
    });

    const updated = await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
    res.json({ success: true, balance: updated?.balance ?? 0, txSignature: signature });
  } catch (err) {
    console.error("[Withdraw] Error:", err);
    // Best-effort refund if we debited but never reached a refund path above.
    if (debited) {
      try {
        await db.transaction(async (tx) => {
          await tx.update(users)
            .set({ balance: sql`${users.balance} + ${amountNum}` })
            .where(eq(users.wallet, wallet));
          await tx.update(transactions)
            .set({ status: "failed", metadata: JSON.stringify({ error: String(err) }) })
            .where(eq(transactions.id, txId));
        });
      } catch (refundErr) {
        console.error("[Withdraw] CRITICAL: refund failed, manual reconcile needed:", refundErr, "txId:", txId);
      }
    }
    res.status(500).json({ error: "Withdrawal failed" });
  } finally {
    withdrawLocks.delete(wallet);
  }
});

// GET /api/wallet/balance/:address
router.get("/balance/:address", async (req: Request, res: Response) => {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.wallet, req.params.address) });
    res.json({
      balance: user?.balance ?? 0,
      totalDeposits: user?.totalDeposits ?? 0,
      totalWithdrawals: user?.totalWithdrawals ?? 0,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

// GET /api/wallet/transactions/:address
router.get("/transactions/:address", async (req: Request, res: Response) => {
  try {
    const txs = await db.query.transactions.findMany({
      where: eq(transactions.wallet, req.params.address),
      orderBy: [desc(transactions.createdAt)],
      limit: 50,
    });
    res.json(txs);
  } catch {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

export default router;
