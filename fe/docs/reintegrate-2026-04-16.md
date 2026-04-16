# FE Re-Integration — 2026-04-16

Handoff doc buat partner FE. BE cycle 08 udah push (`05427f2`) ngebalikin `durationMin` di schema + paralel 5m/15m generator. FE-side follow-up ga ikut di-push — draft perubahan gua tinggal di working tree sebagai referensi.

Lihat `fe/docs/updateBe-08.md` untuk context BE lengkap. File ini fokus ke FE task list + snippet siap-comot.

---

## Cara adopt

Lo punya tiga opsi:

**(A) Apply diff as-is.** Paling cepet. Gua udah tulis 10 file FE change yang konsisten sama BE spec. Cek `git status` — semua masih uncommitted. Test, commit dengan nama lo, push.

**(B) Cherry-pick sebagian.** Ambil yang lo setuju (mapper + types paling minimal), tulis ulang yang lain (misal filter UI lo mau beda style). Diff lengkap ada di bawah.

**(C) Fresh rewrite.** `git checkout -- fe/src/` buat discard draft gua, baca spec di `missIntegrateBe.md` + cycle 08, build dari nol.

Kalo pilih (A) atau (B), pastiin `git diff HEAD -- fe/` bersih sebelum commit supaya ga kecampur sama file yang ga intended.

---

## Task list (priority order)

| # | Task | File | Blocker level |
|---|------|------|---------------|
| 1 | Tambah field `durationMin: 5 \| 15` di `PredictionMarket` type | `fe/src/lib/types.ts` | **P0** — tanpa ini semua task turunan ga bisa compile |
| 2 | Map `durationMin` di `mapMarket()` + WS NEW_MARKET handler | `fe/src/lib/api.ts`, `fe/src/hooks/useMarkets.ts` | **P0** |
| 3 | Pass `durationMin` ke `computeShareWeight` + payoutWeight `WeightInputs` terima field-nya | `fe/src/components/TradeModal.tsx`, `fe/src/lib/payoutWeight.ts` | **P0** — kalo skip, preview share weight salah untuk 15m market |
| 4 | MarketCard badge show 5m/15m + countdown window pake `market.durationMin` | `fe/src/components/MarketCard.tsx` | **P1** |
| 5 | BucketPill `opensIn` pake `market.durationMin` | `fe/src/components/BucketPill.tsx` | **P1** |
| 6 | Explore page chip filter "Any Duration / 5m / 15m" + badge di card row | `fe/src/app/explore/page.tsx` | **P1** |
| 7 | UTC time display di BucketPill (bucket lineup) | `fe/src/components/BucketPill.tsx` | **P0** — product requirement |
| 8 | UTC datetime di Profile page (vote + tx rows) | `fe/src/app/profile/page.tsx` | **P0** — product requirement |
| 9 | UTC time di SentimentBar ("Updated HH:MM") | `fe/src/components/SentimentBar.tsx` | **P1** |

---

## Snippet per file

Semua snippet di bawah = **diff yang udah gua siapin di working tree**. `+` = tambah, `-` = hapus. File path diset relatif dari repo root.

### 1. `fe/src/lib/types.ts`

```diff
@@ -12,7 +12,8 @@
-  deadline: number; // unix timestamp ms
+  deadline: number; // unix timestamp ms (UTC by definition)
+  durationMin: 5 | 15; // round length in minutes — only 5 or 15
   category: "crypto" | "defi" | "meme" | "layer1" | "layer2";
```

### 2. `fe/src/lib/api.ts` (mapper)

```diff
@@ -23,6 +23,8 @@
+    // Only 5 or 15 is valid; fall back to 5 for defensive decoding.
+    durationMin: (Number(raw.durationMin ?? raw.duration_min ?? 5) === 15 ? 15 : 5) as 5 | 15,
     category: raw.category || "crypto",
```

### 3. `fe/src/hooks/useMarkets.ts` (WS NEW_MARKET handler)

```diff
@@ -126,6 +126,7 @@
+        durationMin: (Number(raw.durationMin ?? raw.duration_min ?? 5) === 15 ? 15 : 5) as 5 | 15,
         category: (raw.category as PredictionMarket["category"]) || "crypto",
```

### 4. `fe/src/lib/payoutWeight.ts` (mirror BE)

```diff
@@ -5,19 +5,20 @@
-const MARKET_DURATION_MS = 5 * 60_000;

 export interface WeightInputs {
   targetPoolBefore: number;
   oppositePoolBefore: number;
   deadline: number;
   now: number;
+  durationMin: number;
 }

 export function computeShareWeight(input: WeightInputs): number {
-  const { targetPoolBefore, oppositePoolBefore, deadline, now } = input;
-  const remaining = Math.max(0, Math.min(MARKET_DURATION_MS, deadline - now));
-  const timeFraction = remaining / MARKET_DURATION_MS;
+  const { targetPoolBefore, oppositePoolBefore, deadline, now, durationMin } = input;
+  const durationMs = Math.max(1, durationMin * 60_000);
+  const remaining = Math.max(0, Math.min(durationMs, deadline - now));
+  const timeFraction = remaining / durationMs;
```

### 5. `fe/src/components/TradeModal.tsx`

```diff
@@ -56,6 +56,7 @@
+        durationMin: market.durationMin,
       })
     : 1;
```

### 6. `fe/src/components/BucketPill.tsx` (UTC + duration-aware opensIn)

```diff
@@ -14,13 +14,17 @@
+// All market times display in UTC so deadlines are unambiguous for a global
+// user base. Don't swap to local TZ without product sign-off.
+const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
+  hour: "2-digit",
+  minute: "2-digit",
+  hour12: false,
+  timeZone: "UTC",
+});
+
 function formatTime(ms: number): string {
-  const d = new Date(ms);
-  let h = d.getHours();
-  const m = String(d.getMinutes()).padStart(2, "0");
-  const ampm = h >= 12 ? "PM" : "AM";
-  h = h % 12 || 12;
-  return `${h}:${m} ${ampm}`;
+  return `${TIME_FMT.format(new Date(ms))} UTC`;
 }

@@ -58,7 +62,7 @@
-  const opensIn = market.deadline - 5 * 60_000 - now;
+  const opensIn = market.deadline - market.durationMin * 60_000 - now;
```

### 7. `fe/src/components/MarketCard.tsx` (duration-aware window + badge)

```diff
@@ -88,12 +88,13 @@
-  // deadline and filter to the relevant slice (5min bucket + small pre/post
+  // deadline and filter to the relevant slice (bucket duration + small pre/post
   // padding). 6h window covers any realistic past bucket shown in the timeline.
   useEffect(() => {
     if (!selectedBucket) return;
     let cancelled = false;
-    const start = selectedBucket.deadline - 5 * 60_000 - 3 * 60 * 1000; // bucket + 3min lead-in
+    const bucketMs = selectedBucket.durationMin * 60_000;
+    const start = selectedBucket.deadline - bucketMs - 3 * 60 * 1000; // bucket + 3min lead-in
     const end = selectedBucket.deadline + 60_000; // 1min post-settlement

@@ -117,10 +118,10 @@
-    const WINDOW_MS = 5 * 60_000;
+    const windowMs = market.durationMin * 60_000;
     const tick = () => {
       const d = Math.max(0, market.deadline - Date.now());
-      const capped = Math.min(d, WINDOW_MS);
+      const capped = Math.min(d, windowMs);
       setCd({
         m: Math.floor(capped / 60000),
         s: Math.floor((capped % 60000) / 1000),
@@ -129,7 +130,7 @@
-  }, [market.deadline]);
+  }, [market.deadline, market.durationMin]);

@@ -216,11 +217,17 @@
-            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-white/10 text-white/60">
-              5m
+            <span
+              className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
+                market.durationMin === 15
+                  ? "bg-[#00b482]/15 text-[#00b482]"
+                  : "bg-white/10 text-white/60"
+              }`}
+            >
+              {market.durationMin}m
             </span>
           </div>
-          <p className="text-white/20 text-[11px]">5 Minutes</p>
+          <p className="text-white/20 text-[11px]">{market.durationMin} Minutes</p>
```

### 8. `fe/src/components/SentimentBar.tsx`

```diff
@@ -77,7 +77,7 @@
-              Updated {new Date(data.lastUpdated).toLocaleTimeString()} · {data.mentionCount} mentions
+              Updated {new Date(data.lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC · {data.mentionCount} mentions
```

### 9. `fe/src/app/profile/page.tsx` (UTC formatters)

```diff
@@ -19,6 +19,18 @@
+// All timestamps render in UTC — consistent across every user regardless of
+// local TZ, matching how BE stores deadlines.
+const UTC_DATETIME = new Intl.DateTimeFormat("en-GB", {
+  year: "numeric", month: "short", day: "2-digit",
+  hour: "2-digit", minute: "2-digit", hour12: false,
+  timeZone: "UTC",
+});
+const UTC_DATE = new Intl.DateTimeFormat("en-GB", {
+  year: "numeric", month: "short", day: "2-digit",
+  timeZone: "UTC",
+});
+
 interface VoteEntry {

@@ -185,7 +197,7 @@
-                      ${vote.amount.toFixed(2)} · {new Date(vote.createdAt).toLocaleString()}
+                      ${vote.amount.toFixed(2)} · {UTC_DATETIME.format(new Date(vote.createdAt))} UTC

@@ -224,7 +236,7 @@
-                    <p className="text-white/20 text-[10px]">{new Date(tx.createdAt).toLocaleDateString()}</p>
+                    <p className="text-white/20 text-[10px]">{UTC_DATE.format(new Date(tx.createdAt))} UTC</p>
```

### 10. `fe/src/app/explore/page.tsx` (chip filter + badge)

```diff
@@ -9,6 +9,7 @@
 type Filter = "all" | "trending" | "ending";
+type DurationFilter = "all" | 5 | 15;

@@ -19,6 +20,7 @@
   const [filter, setFilter] = useState<Filter>("all");
+  const [duration, setDuration] = useState<DurationFilter>("all");
   const [search, setSearch] = useState("");

@@ -36,6 +38,7 @@
+    .filter((m) => duration === "all" || m.durationMin === duration)
     .sort((a, b) => {

@@ -54,6 +57,12 @@
+  const durations: { key: DurationFilter; label: string }[] = [
+    { key: "all", label: "Any Duration" },
+    { key: 5, label: "5m" },
+    { key: 15, label: "15m" },
+  ];

@@ -74,12 +83,12 @@
-      <div className="flex gap-2 mb-4">
+      <div className="flex gap-2 mb-2 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
         {filters.map((f) => (
           <button
             key={f.key}
             onClick={() => setFilter(f.key)}
-            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150"
+            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150"

@@ -91,6 +100,24 @@
+      {/* Duration filter */}
+      <div className="flex gap-2 mb-4 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
+        {durations.map((d) => (
+          <button
+            key={String(d.key)}
+            onClick={() => setDuration(d.key)}
+            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150"
+            style={{
+              background: duration === d.key ? "rgba(0,209,169,0.15)" : "rgba(255,255,255,0.04)",
+              color: duration === d.key ? "var(--color-yes)" : "rgba(255,255,255,0.4)",
+              border: `1px solid ${duration === d.key ? "rgba(0,209,169,0.3)" : "rgba(255,255,255,0.06)"}`,
+            }}
+          >
+            {d.label}
+          </button>
+        ))}
+      </div>

@@ -121,6 +148,15 @@
+                      <span
+                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
+                          market.durationMin === 15
+                            ? "bg-[#00b482]/15 text-[#00b482]"
+                            : "bg-white/10 text-white/60"
+                        }`}
+                      >
+                        {market.durationMin}m
+                      </span>
```

---

## Sanity check setelah integrate

- [ ] `bunx tsc --noEmit` — FE 0 error.
- [ ] Boot BE + FE, buka `/` feed → card BTC muncul dengan badge `5m` atau `15m` (harusnya ada dua BTC card karena paralel).
- [ ] Buka Explore → chip "5m" → hanya market 5m. Chip "15m" → hanya 15m. Chip "Any Duration" → semua.
- [ ] Vote di card 15m → TradeModal preview share weight ≠ 1.0 kalau pool udah skewed + waktu deadline deket. Kalau masih 1.0 selalu, artinya `durationMin` belum ke-pass.
- [ ] Timeline (BucketPill) di MarketCard → waktunya append `UTC` di belakang, format HH:MM (24-hour).
- [ ] Profile vote history row → tampilin tanggal + waktu UTC.
- [ ] Rebuka laptop pake timezone Jakarta atau Tokyo — semua timestamp ga berubah (karena lock UTC).

---

## Kalau ada pertanyaan

- Kenapa 1m ga boleh — lihat `~/.claude/projects/.../feedback_fixed_5min_duration.md` summary atau tanya owner repo. Pendek: product decision, sempet nyoba 1m/5m/15m tapi timeline-nya jadi confusing (deretan menit berurutan).
- Kenapa pake `en-GB` di `Intl.DateTimeFormat` — locale default-nya 24-hour tanpa AM/PM, yang cocok buat "HH:MM UTC" style. Locale lain boleh asal hasilnya konsisten.
- Kalau BE forgot to include `duration_min` di response dari endpoint tertentu — mapper default ke 5 (legacy safe fallback), jadi UI tetep jalan tapi anggap market 5m. Kalo FE nemu market yang seharusnya 15m ke-default 5m, laporin — kemungkinan ada endpoint BE yang belum di-update.
