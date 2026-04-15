import { signAuthHeaders } from "./signAuth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: "no-window" | "no-sw" | "no-push" | "no-notification" };

/**
 * Feature-detect browser capabilities. Web Push needs all of: window context,
 * ServiceWorker API, PushManager, Notification API. iOS Safari <16.4 will
 * fail here, which is the expected behavior — we don't want to half-subscribe.
 */
export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") return { supported: false, reason: "no-window" };
  if (!("serviceWorker" in navigator)) return { supported: false, reason: "no-sw" };
  if (!("PushManager" in window)) return { supported: false, reason: "no-push" };
  if (!("Notification" in window)) return { supported: false, reason: "no-notification" };
  return { supported: true };
}

// Produce a plain ArrayBuffer (not Uint8Array) so the type lines up with the
// PushManager.subscribe applicationServerKey contract across TS lib targets.
function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/notifications/vapid-public-key`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.publicKey || null;
  } catch {
    return null;
  }
}

/**
 * Returns the current push subscription for this browser if one exists,
 * regardless of which wallet it was registered against. FE uses this to
 * render "Enabled" vs "Disabled" state on the settings toggle.
 */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const support = detectPushSupport();
  if (!support.supported) return null;
  try {
    const reg = await registerServiceWorker();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

interface Signer {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "permission-denied" | "no-vapid" | "sign-failed" | "server-error"; detail?: string };

/**
 * Full subscribe flow: SW register → ask permission → PushManager.subscribe →
 * signed POST to BE. If any step fails we surface a typed reason so the UI
 * can render the right help text (e.g. "enable notifications in browser
 * settings" vs. "push is off server-side").
 */
export async function subscribeToPush(
  wallet: string,
  provider: Signer,
): Promise<SubscribeResult> {
  const support = detectPushSupport();
  if (!support.supported) return { ok: false, reason: "unsupported", detail: support.reason };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "permission-denied" };

  const publicKey = await getVapidPublicKey();
  if (!publicKey) return { ok: false, reason: "no-vapid" };

  const reg = await registerServiceWorker();
  // If already subscribed (same browser/device), pushManager.subscribe is
  // idempotent — returns the existing sub. We still re-POST so BE knows this
  // endpoint maps to the current wallet (user could switch wallets).
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToArrayBuffer(publicKey),
  });

  let signed;
  try {
    signed = await signAuthHeaders(provider, "SUBSCRIBE_PUSH", wallet);
  } catch (err) {
    return { ok: false, reason: "sign-failed", detail: (err as Error).message };
  }

  const res = await fetch(`${API_URL}/api/notifications/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...signed.headers },
    body: JSON.stringify({ userWallet: wallet, subscription: subscription.toJSON() }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "server-error" }));
    return { ok: false, reason: "server-error", detail: err.error };
  }

  return { ok: true };
}

export async function unsubscribeFromPush(wallet: string, provider: Signer): Promise<SubscribeResult> {
  const support = detectPushSupport();
  if (!support.supported) return { ok: false, reason: "unsupported" };

  const reg = await registerServiceWorker();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true }; // already unsubscribed

  const endpoint = sub.endpoint;

  // Sign BEFORE we tear down the subscription locally, so a failed server
  // call doesn't leave FE/BE out of sync.
  let signed;
  try {
    signed = await signAuthHeaders(provider, "UNSUBSCRIBE_PUSH", wallet);
  } catch (err) {
    return { ok: false, reason: "sign-failed", detail: (err as Error).message };
  }

  const res = await fetch(`${API_URL}/api/notifications/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...signed.headers },
    body: JSON.stringify({ userWallet: wallet, endpoint }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "server-error" }));
    return { ok: false, reason: "server-error", detail: err.error };
  }

  await sub.unsubscribe();
  return { ok: true };
}
