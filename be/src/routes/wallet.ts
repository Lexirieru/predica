import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { users, transactions } from "../db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { verifyDeposit, sendUsdp } from "../lib/solana";
import { authMiddleware } from "../lib/middleware";

const router = Router();

const MIN_AMOUNT = 1;        // $1 minimum deposit/withdraw
const MAX_AMOUNT = 1_000_000; // $1M cap

const DepositSchema = z.object({
  wallet: z.string().min(20).max(64),
  amount: z.coerce.number().positive().finite().min(MIN_AMOUNT).max(MAX_AMOUNT),
  txSignature: z.string().min(40).max(200),
});

const WithdrawSchema = z.object({
  wallet: z.string().min(20).max(64),
  amount: z.coerce.number().positive().finite().min(MIN_AMOUNT).max(MAX_AMOUNT),
});

// POST /api/wallet/deposit
router.post("/deposit", async (req: Request, res: Response) => {
  const parsed = DepositSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deposit payload", details: parsed.error.issues });
    return;
  }
  const { wallet, amount: amountNum, txSignature } = parsed.data;

  try {

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
//   1. Acquire Postgres advisory lock scoped to this wallet (survives server restart,
//      works across multiple BE instances).
//   2. Atomic conditional debit + insert pending tx row.
//   3. Send USDP on-chain.
//   4. On success: mark tx confirmed + bump totalWithdrawals.
//   5. On failure: refund balance + mark tx failed.
router.post("/withdraw", authMiddleware("WITHDRAW"), async (req: Request, res: Response) => {
  const parsed = WithdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid withdraw payload", details: parsed.error.issues });
    return;
  }
  const { wallet, amount: amountNum } = parsed.data;

  // NOTE: Previously used pg_advisory_lock to serialize concurrent withdraws,
  // but it's incompatible with Supabase transaction pooler (port 6543) — locks
  // get orphaned because acquire/release land on different physical connections.
  // The atomic conditional debit below is sufficient: if two concurrent withdraws
  // race, only one will succeed in debiting; the other gets INSUFFICIENT_BALANCE.
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
  }
});

// GET /api/wallet/balance/:address
router.get("/balance/:address", async (req: Request, res: Response) => {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.wallet, String(req.params.address)) });
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
      where: eq(transactions.wallet, String(req.params.address)),
      orderBy: [desc(transactions.createdAt)],
      limit: 50,
    });
    res.json(txs);
  } catch {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

export default router;
