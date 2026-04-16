# BE Update Cycle 03

**Status:** ✅ PUSHED — 2026-04-16 (sealed at `85faa83`)
**Branch:** `james`
**Started:** 2026-04-15
**Sealed:** 2026-04-16

---

## 🎯 TL;DR — Yang Perlu FE Lakukan

| Action | File FE | Detail |
|--------|---------|--------|
| Render durasi market dinamis — jangan hardcode "5 min" di card | `src/components/MarketCard.tsx`, timer/countdown components | [§Market variety](#3-market-variety--1m-5m-15m) |
| Group / filter feed by durasi kalau mau (opsional) | `src/app/feed/page.tsx` | Response market sekarang punya field `durationMin` (1, 5, atau 15) |

**Breaking changes:** none (field `durationMin` additive, existing markets back-filled dengan default 5 via migration).

---

## 📦 Commits

### (unpushed) — 2026-04-15
**Title:** chore: exclude non-crypto Pacifica symbols from market generation

**Files:**
- `be/src/lib/crons.ts`

#### Crypto-only market filter
Pacifica's perp list bercampur asset class — ada equities (NVDA, TSLA, GOOGL, AAPL, AMZN, MSTR, HOOD, CRCL, PLTR, BP, SPY, QQQ, SP500), forex (USDJPY, EURUSD, GBPUSD, USDKRW), commodities (XAU, XAG, NATGAS, COPPER, PLATINUM, URNM, CL). Predica adalah crypto prediction market, jadi semua non-crypto di-skip waktu bucket generation di `ensureUpcomingBuckets()`:

- Filter diterapkan di dua tempat: curated loop **dan** trending loop, sebelum cek `pacificaSymbols`.
- `NON_CRYPTO_SYMBOLS` hidup sebagai Set konstanta di `crons.ts`. Tambah entry di situ kalau ke depannya Pacifica list asset kelas baru yang bukan crypto.

**FE impact:** zero. FE cuma consume market list yang muncul dari generator.

### (unpushed) — 2026-04-15
**Title:** feat: market duration variety — 1m / 5m / 15m windows

**Files:**
- `be/src/db/schema.ts` (new `durationMin` column on `markets`)
- `be/src/db/migrate.ts` (additive ALTER TABLE with default 5)
- `be/src/db/dal.ts` (`getBySymbolDeadline` + `getDueForActivation` scoped per-row duration)
- `be/src/lib/crons.ts` (per-duration bucket generation loop)

#### 3. Market variety — 1m / 5m / 15m
Sebelumnya semua market durasinya 5 menit hard-coded. Sekarang generator bikin 3 series paralel:

| Duration | Horizon pre-create | Symbol set |
|----------|--------------------|------------|
| **1m** | 15 menit ke depan | Top-tier saja: `BTC`, `ETH`, `SOL` |
| **5m** | 60 menit ke depan | Semua symbol eligible (Pacifica ∩ Elfa) |
| **15m** | 180 menit ke depan | Semua symbol eligible |

**Kenapa 1m cuma top-tier?** Satu jam × banyak symbol = ledakan row count. Top-liquidity coins juga punya mark-price stream paling stabil, jadi settlement 1m ga nyangkut gara-gara RPC lag.

**Field baru di response market:**
```ts
{
  id: "...",
  symbol: "BTC",
  question: "BTC Price: Higher or Lower in 1 min?",
  durationMin: 1,          // <-- NEW: 1 | 5 | 15
  deadline: 1776200460000,
  targetPrice: 65432.1,
  // ... existing fields unchanged
}
```

**Idempotency:** sekarang scoped ke (symbol, deadline, durationMin). Jadi market 5m dan 15m yang kebetulan deadline-nya sama jam wall-clock (misal sama-sama end di :15) nggak saling block pas re-create.

**FE rendering suggestion:**
- Pakai `market.durationMin` untuk label timer ("1 MIN", "5 MIN", "15 MIN") di card.
- Question text `question` sudah auto-reflect durasi, jadi bisa tetep di-render as-is.
- Filter tab di feed (All / 1m / 5m / 15m) optional — tapi bisa jadi UX win buat users yang mau rapid-fire mode vs. patient mode.
- Countdown / progress bar: gunakan `durationMin * 60000` untuk compute total length, deadline udah ada.

**Migration safety:** `duration_min` ditambahkan via `ALTER TABLE ADD COLUMN IF NOT EXISTS ... DEFAULT 5`. Row existing otomatis dapet 5, jadi nggak ada breakage untuk market yang udah hidup.

### (unpushed) — 2026-04-15
**Title:** feat: web push notifications on market resolve

**Files:**
- `be/src/db/schema.ts` (new `push_subscriptions` table)
- `be/src/db/migrate.ts` (migration for new table + indexes)
- `be/src/lib/webpush.ts` (new — VAPID init, `sendPushToWallet()`)
- `be/src/routes/notifications.ts` (new endpoints)
- `be/src/routes/votes.ts` → no change; settlement is in `crons.ts`
- `be/src/lib/crons.ts` (fire push per participant after settlement commit)
- `be/src/index.ts` (register router)
- `be/.env.example` (VAPID env vars documented)
- `be/package.json` (+ `web-push` + `@types/web-push`; removed broken `nacl` dep)

#### 4. Push Notifications
Market user resolve → BE push notifikasi ke semua wallet yang participate. Pakai **Web Push API + VAPID** (browser-native, works across Chrome/Firefox/Edge/Safari 16+).

**Graceful degradation:** kalau `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` nggak di-set di env, push disabled — endpoints return `503`, settlement tetep jalan normal tanpa push. Jadi dev local nggak wajib generate VAPID keys.

**Generate VAPID keys:**
```bash
npx web-push generate-vapid-keys
# Copy output ke be/.env:
# VAPID_PUBLIC_KEY=...
# VAPID_PRIVATE_KEY=...
# VAPID_SUBJECT=mailto:admin@predica.local
```

**Endpoints baru:**

`GET /api/notifications/vapid-public-key` — FE butuh ini buat `PushManager.subscribe({ applicationServerKey })`:
```ts
// 200 OK
{ publicKey: "BHx...long-base64-url-string" }
// 503 if unconfigured
{ error: "Web Push not configured on this server" }
```

`POST /api/notifications/subscribe` — register browser subscription. **Signed** (authMiddleware, action = `"SUBSCRIBE_PUSH"`):
```ts
// Request body
{
  userWallet: "7Xyz...",
  subscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/...",
    keys: { p256dh: "...", auth: "..." }
  }
}
// Headers: x-signature, x-timestamp (same pattern as vote/withdraw)
// Response: 201 { success: true }
```

Upsert by endpoint — same browser re-subscribe cuma refresh keys, bukan bikin duplicate.

`POST /api/notifications/unsubscribe` — **signed** (action = `"UNSUBSCRIBE_PUSH"`):
```ts
{ userWallet: "7Xyz...", endpoint: "https://fcm.googleapis.com/..." }
// Response: { success: true }
```

**Push payload format (yang FE terima via service worker):**
```ts
{
  title: "🎉 You won +$12.34!" | "💔 You lost $5.00",
  body: "BTC resolved UP @ $65432.1234",
  tag: "market:abc-123",              // dedupe key — same market retry won't double-notify
  url: "/markets/abc-123",            // deep-link on click
  data: {
    marketId: "abc-123",
    symbol: "BTC",
    resolution: "yes" | "no",
    won: true,
    payout: 17.34,
    profit: 12.34
  }
}
```

**FE integration checklist:**

1. **Service worker** (e.g. `public/sw.js`):
   ```js
   self.addEventListener("push", (event) => {
     const payload = event.data.json();
     event.waitUntil(
       self.registration.showNotification(payload.title, {
         body: payload.body,
         tag: payload.tag,
         data: payload.data,
         icon: "/icon-192.png",
         badge: "/badge-72.png",
       })
     );
   });

   self.addEventListener("notificationclick", (event) => {
     event.notification.close();
     event.waitUntil(clients.openWindow(payload?.data?.url || "/"));
   });
   ```

2. **Register SW + subscribe flow** (call after wallet connected):
   ```ts
   const reg = await navigator.serviceWorker.register("/sw.js");
   const perm = await Notification.requestPermission();
   if (perm !== "granted") return;

   const { publicKey } = await fetch("/api/notifications/vapid-public-key").then(r => r.json());
   const sub = await reg.pushManager.subscribe({
     userVisibleOnly: true,
     applicationServerKey: urlBase64ToUint8Array(publicKey), // standard helper
   });

   // Sign same pattern as vote/withdraw:
   const timestamp = Date.now();
   const message = `SUBSCRIBE_PUSH:${wallet}:${timestamp}`;
   const signature = await signMessage(message); // existing wallet signer
   await fetch("/api/notifications/subscribe", {
     method: "POST",
     headers: {
       "Content-Type": "application/json",
       "x-signature": signature,
       "x-timestamp": String(timestamp),
     },
     body: JSON.stringify({ userWallet: wallet, subscription: sub.toJSON() }),
   });
   ```

3. **Settings UI:** checkbox "Enable push notifications" di profile page. Panggil unsubscribe pas user disable.

**Kenapa signed?** Biar orang jahat nggak bisa spam subscribe endpoint orang lain atau wipe subscription orang lain dengan tebak endpoint URL.

**Kenapa `userVisibleOnly: true`?** Chrome mandate — silent push dilarang. Pasti muncul notif.

**Per-endpoint cleanup:** kalau browser respond `404` / `410 Gone` (user uninstall SW, reset browser), BE auto-delete row dari `push_subscriptions`. Jadi DB self-heals.
