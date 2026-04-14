import { Request, Response, NextFunction } from "express";
import { verifySolanaSignature, getAuthMessage } from "./auth";

/**
 * Middleware untuk verifikasi signature Solana pada request yang sensitif (Vote, Withdraw, dll)
 * Menggunakan Header untuk signature dan timestamp guna mencegah replay attack.
 */
export function authMiddleware(action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = req.headers["x-signature"] as string;
      const timestamp = parseInt(req.headers["x-timestamp"] as string || "0");
      const wallet = req.body.userWallet || req.body.wallet;

      if (!signature || !timestamp || !wallet) {
        res.status(401).json({ error: "Missing authentication headers (signature, timestamp, or wallet)" });
        return;
      }

      // 1. Prevent Replay Attack: Cek jika timestamp terlalu lama (> 5 menit)
      const now = Date.now();
      if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
        res.status(401).json({ error: "Request expired. Please check your system clock." });
        return;
      }

      // 2. Reconstruct the message that was signed by the frontend
      const message = getAuthMessage(action, wallet, timestamp);

      // 3. Verify the signature
      const isValid = verifySolanaSignature(message, signature, wallet);

      if (!isValid) {
        res.status(401).json({ error: "Invalid signature. Authentication failed." });
        return;
      }

      // Signature valid, lanjut ke controller
      next();
    } catch (err) {
      console.error("[Middleware] Auth Error:", err);
      res.status(500).json({ error: "Internal authentication error" });
    }
  };
}
