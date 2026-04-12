import { Router, Request, Response } from "express";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";
import { verifyDeposit, sendUsdp, getBackendUsdpBalance } from "../lib/solana";

const router = Router();

// POST /api/wallet/deposit — verify deposit tx and credit balance
router.post("/deposit", async (req: Request, res: Response) => {
  try {
    const { wallet, amount, txSignature } = req.body;

    if (!wallet || !amount || !txSignature) {
      res.status(400).json({ error: "Missing wallet, amount, or txSignature" });
      return;
    }

    const db = getDb();

    // Check if tx already processed
    const existing = db.prepare("SELECT id FROM transactions WHERE tx_signature = ?").get(txSignature);
    if (existing) {
      res.status(400).json({ error: "Transaction already processed" });
      return;
    }

    // Verify on-chain
    const verified = await verifyDeposit(txSignature, parseFloat(amount), wallet);
    if (!verified) {
      res.status(400).json({ error: "Deposit not verified on-chain. Wait a few seconds and try again." });
      return;
    }

    const id = uuid();
    const amountNum = parseFloat(amount);

    // Upsert user + credit balance
    db.prepare(`
      INSERT INTO users (wallet, balance, total_deposits)
      VALUES (?, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        balance = balance + ?,
        total_deposits = total_deposits + ?
    `).run(wallet, amountNum, amountNum, amountNum, amountNum);

    // Record transaction
    db.prepare(`
      INSERT INTO transactions (id, wallet, type, amount, tx_signature, status)
      VALUES (?, ?, 'deposit', ?, ?, 'confirmed')
    `).run(id, wallet, amountNum, txSignature);

    const user = db.prepare("SELECT balance FROM users WHERE wallet = ?").get(wallet) as { balance: number };

    res.json({ success: true, balance: user.balance, txId: id });
  } catch (err) {
    console.error("[Deposit] Error:", err);
    res.status(500).json({ error: "Deposit failed" });
  }
});

// POST /api/wallet/withdraw — send USDP to user
router.post("/withdraw", async (req: Request, res: Response) => {
  try {
    const { wallet, amount } = req.body;

    if (!wallet || !amount) {
      res.status(400).json({ error: "Missing wallet or amount" });
      return;
    }

    const amountNum = parseFloat(amount);
    const db = getDb();

    // Check user balance
    const user = db.prepare("SELECT balance FROM users WHERE wallet = ?").get(wallet) as { balance: number } | undefined;
    if (!user || user.balance < amountNum) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    // Check backend wallet has enough
    const backendBalance = await getBackendUsdpBalance();
    if (backendBalance < amountNum) {
      res.status(400).json({ error: "Platform temporarily unable to process withdrawal" });
      return;
    }

    // Send USDP on-chain
    const txSignature = await sendUsdp(wallet, amountNum);

    // Debit balance
    db.prepare("UPDATE users SET balance = balance - ?, total_withdrawals = total_withdrawals + ? WHERE wallet = ?")
      .run(amountNum, amountNum, wallet);

    const id = uuid();
    db.prepare(`
      INSERT INTO transactions (id, wallet, type, amount, tx_signature, status)
      VALUES (?, ?, 'withdraw', ?, ?, 'confirmed')
    `).run(id, wallet, amountNum, txSignature);

    const updated = db.prepare("SELECT balance FROM users WHERE wallet = ?").get(wallet) as { balance: number };

    res.json({ success: true, balance: updated.balance, txSignature });
  } catch (err) {
    console.error("[Withdraw] Error:", err);
    res.status(500).json({ error: "Withdrawal failed" });
  }
});

// GET /api/wallet/balance/:address — get internal balance
router.get("/balance/:address", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT balance, total_deposits, total_withdrawals FROM users WHERE wallet = ?")
      .get(req.params.address) as { balance: number; total_deposits: number; total_withdrawals: number } | undefined;

    res.json({
      balance: user?.balance || 0,
      totalDeposits: user?.total_deposits || 0,
      totalWithdrawals: user?.total_withdrawals || 0,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

// GET /api/wallet/transactions/:address
router.get("/transactions/:address", (req: Request, res: Response) => {
  try {
    const db = getDb();
    const txs = db.prepare("SELECT * FROM transactions WHERE wallet = ? ORDER BY created_at DESC LIMIT 50")
      .all(req.params.address);
    res.json(txs);
  } catch {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

export default router;
