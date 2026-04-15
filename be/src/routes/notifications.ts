import { Router, Request, Response } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db } from "../db";
import { pushSubscriptions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { isPushConfigured, getPublicKey } from "../lib/webpush";
import { authMiddleware } from "../lib/middleware";

const router = Router();

const SubscriptionSchema = z.object({
  userWallet: z.string().min(20).max(64),
  subscription: z.object({
    endpoint: z.string().url().max(1024),
    keys: z.object({
      p256dh: z.string().min(1).max(256),
      auth: z.string().min(1).max(256),
    }),
  }),
});

const UnsubscribeSchema = z.object({
  userWallet: z.string().min(20).max(64),
  endpoint: z.string().url().max(1024),
});

// GET /api/notifications/vapid-public-key
// FE needs the public key to call PushManager.subscribe({ applicationServerKey }).
router.get("/vapid-public-key", (_req: Request, res: Response) => {
  if (!isPushConfigured()) {
    res.status(503).json({ error: "Web Push not configured on this server" });
    return;
  }
  res.json({ publicKey: getPublicKey() });
});

// POST /api/notifications/subscribe
// Upsert by endpoint: same browser re-subscribing just refreshes the keys and
// wallet linkage rather than creating duplicates.
router.post("/subscribe", authMiddleware("SUBSCRIBE_PUSH"), async (req: Request, res: Response) => {
  if (!isPushConfigured()) {
    res.status(503).json({ error: "Web Push not configured on this server" });
    return;
  }

  const parsed = SubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid subscription payload", details: parsed.error.issues });
    return;
  }

  const { userWallet, subscription } = parsed.data;
  const { endpoint, keys } = subscription;

  try {
    await db.insert(pushSubscriptions)
      .values({
        id: uuid(),
        wallet: userWallet,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { wallet: userWallet, p256dh: keys.p256dh, auth: keys.auth },
      });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error("[Notifications] Subscribe error:", err);
    res.status(500).json({ error: "Subscription failed" });
  }
});

// POST /api/notifications/unsubscribe
// Auth-gated: caller must sign the request so a malicious actor can't
// wipe someone else's subscriptions by guessing endpoint URLs.
router.post("/unsubscribe", authMiddleware("UNSUBSCRIBE_PUSH"), async (req: Request, res: Response) => {
  const parsed = UnsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const { userWallet, endpoint } = parsed.data;
  try {
    await db.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.wallet, userWallet)));
    res.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Unsubscribe error:", err);
    res.status(500).json({ error: "Unsubscribe failed" });
  }
});

export default router;
