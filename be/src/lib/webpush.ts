import webpush from "web-push";
import { db } from "../db";
import { pushSubscriptions } from "../db/schema";
import { eq } from "drizzle-orm";

// Web Push is optional infrastructure. When VAPID keys aren't configured
// we disable send/subscribe gracefully — endpoints return 503 with a clear
// message, settlement broadcasts still go out via WS. This keeps the server
// runnable in dev without forcing every contributor to generate VAPID keys.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@predica.local";

let configured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
    console.log("[WebPush] VAPID configured — push notifications enabled");
  } catch (err) {
    console.error("[WebPush] VAPID setup failed, push disabled:", err);
  }
} else {
  console.log("[WebPush] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push disabled");
}

export function isPushConfigured(): boolean {
  return configured;
}

export function getPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;        // dedupes notifications of same tag on the client
  url?: string;        // deep-link when notification clicked
  icon?: string;
  data?: Record<string, any>;
}

/**
 * Send a push to every subscription registered for `wallet`. Failures are
 * per-subscription: if one endpoint is 410 Gone (unsubscribed), we purge it
 * from DB; transient errors are logged but don't abort the rest of the send.
 */
export async function sendPushToWallet(wallet: string, payload: PushPayload): Promise<void> {
  if (!configured) return;

  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.wallet, wallet),
  });

  if (subs.length === 0) return;

  const json = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          json,
        );
      } catch (err: any) {
        const status = err?.statusCode;
        // 404 / 410 mean the endpoint is permanently dead — clean it up so
        // we don't keep retrying.
        if (status === 404 || status === 410) {
          try {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
            console.log(`[WebPush] Pruned stale endpoint for ${wallet}`);
          } catch (delErr) {
            console.warn("[WebPush] Failed to prune stale endpoint:", delErr);
          }
          return;
        }
        console.warn(`[WebPush] Send failed (${status}) for ${wallet}:`, err?.body || err?.message);
      }
    }),
  );
}
