# BE Update Cycle 08

**Status:** ✅ PUSHED — 2026-04-16 (sealed at `05427f2`)
**Branch:** `james`
**Started:** 2026-04-16
**Sealed:** 2026-04-16

---

## 🎯 TL;DR — Yang Perlu FE Lakukan

Cycle ini **BE-only push**. FE changes sengaja ditinggal di working tree-nya owner repo biar partner FE (yang baru on lagi) yang handle implementasi-nya. Tugas FE partner:

| Task | Priority |
|------|----------|
| Re-introduce `durationMin: 5 \| 15` di `PredictionMarket` type + mapper | P0 (tanpa ini UI ga tau duration tiap market) |
| Tambah chip filter "Any Duration / 5m / 15m" di Explore page — style ngikutin filter chip eksisting | P0 |
| MarketCard badge tampilin `5m` atau `15m` berdasarkan `market.durationMin` (saran: 15m pake warna hijau `#00b482`, 5m pake abu `white/10`) | P1 |
| Lock semua time display ke UTC pake `Intl.DateTimeFormat({ timeZone: "UTC" })` | P0 (product requirement, ga boleh TZ-drift per-user) |

Spec lengkap + referensi implementasi yang belum di-commit ada di local working tree (mapper, filter, UTC formatter). Owner repo bisa share snippet atau FE partner tulis dari scratch.

**Breaking changes untuk FE:** Response dari `/api/markets*` sekarang include field `duration_min` / `durationMin: 5 | 15`. Kalau FE code ga baca field ini, ga akan crash (just ignored) — tapi UI akan seragam keliatan tanpa bisa bedain 5m/15m bucket. Jadi bukan breaking, tapi **wajib integrate** biar produk utuh.

---

## 📦 Commits

### `05427f2` — 2026-04-16
**Title:** feat(be): 5m + 15m parallel markets, duration column

### Konteks

Product revision: atasan user request variasi durasi balik masuk (5m + 15m, tanpa 1m). Cycle 07 sempet strip `durationMin` total — cycle ini bring it back di BE layer + generator produce dua series paralel.

### BE changes

- `be/src/db/schema.ts` — re-add column `durationMin: integer("duration_min").notNull().default(5)`.
- `be/src/db/migrate.ts` — re-add `ALTER TABLE markets ADD COLUMN IF NOT EXISTS duration_min INTEGER NOT NULL DEFAULT 5;`. Idempotent — aman di-run walau column udah ada.
- `be/src/db/dal.ts`:
  - `getBySymbolDeadline(symbol, deadline, durationMin?)` — tiga param, conditional filter biar 5m + 15m sharing same deadline wall-clock (e.g. both ending at :15) ga saling block di idempotency check.
  - `getDueForActivation(now)` — pake `markets.durationMin` dari row (`deadline - durationMin*60000 <= now`) jadi 5m dan 15m aktif di schedule masing-masing.
- `be/src/lib/crons.ts`:
  - `MARKET_DURATIONS: DurationConfig[] = [{ durationMin: 5, horizonMin: 60 }, { durationMin: 15, horizonMin: 180 }]`. Dua series paralel untuk **semua** active symbol (ga ada whitelist per-duration).
  - 5m: 12 slot pre-created (1 jam horizon).
  - 15m: 12 slot pre-created (3 jam horizon).
  - `createBucket(symbol, deadline, durationMin, sentiment, prices)` — 5 param. `question` string pake `${durationMin} min?`.
  - `ensureUpcomingBuckets` — outer loop per-duration config, inner loop per-symbol, innermost per-slot. Setiap config compute slot alignment-nya sendiri + push forward kalau open time udah lewat.
  - Activator pake `m.durationMin * 60_000` per-row (bukan konstan).
- `be/src/lib/payoutWeight.ts` — re-add `durationMin` di `WeightInputs`. Formula pake `durationMs = Math.max(1, durationMin * 60_000)`. Share weight formula duration-invariant at same timeFraction (75-25 favorite halfway → 0.75 regardless of 5m/15m).
- `be/src/routes/votes.ts` — pass `market.durationMin` ke `computeShareWeight`.
- `be/unit-test/payout/payoutWeight.test.ts` — restore `durationMin: DURATION_MIN` di semua fixtures. Nambah test baru "5m and 15m markets give same weight at same timeFraction" buat verify duration-invariance. **40/40 passed**.

### Docs

- `fe/docs/missIntegrateBe.md` section 18 — update ke state baru (5m + 15m paralel, **1m banned**), nambah section "Timezone (UTC)" yang explain semua time display harus lock UTC.

---

## Yang tidak masuk push ini

Berikut FE changes yang udah gua tulis di working tree — **sengaja tidak di-commit** biar FE partner yang decide mau adopt atau rewrite:

- `fe/src/lib/types.ts` — `durationMin: 5 | 15`
- `fe/src/lib/api.ts` + `fe/src/hooks/useMarkets.ts` — map field dari BE (coerce 5/15)
- `fe/src/lib/payoutWeight.ts` — mirror BE `WeightInputs`
- `fe/src/components/TradeModal.tsx` — pass `market.durationMin`
- `fe/src/components/BucketPill.tsx` — UTC formatter + duration-aware `opensIn`
- `fe/src/components/MarketCard.tsx` — duration-aware countdown window + badge variant
- `fe/src/components/SentimentBar.tsx` — UTC formatter
- `fe/src/app/profile/page.tsx` — UTC `Intl.DateTimeFormat` untuk vote + tx row
- `fe/src/app/explore/page.tsx` — duration chip filter + duration badge in card row

Kalau FE partner mau adopt as-is: `git stash pop` or reference directly. Kalau mau rewrite: gua kasih free hand.

---

## Tests

- `bunx tsc --noEmit` (BE) — 2 error pre-existing di `elfaValidator.ts:29` + `sentimentCache.ts:48` soal response typing. Bukan regression.
- `bunx jest` — 40/40 pass across 7 suites. Nambah 1 test.
- Manual boot test pending (DB di Supabase perlu ADD COLUMN migration jalan sekali — idempotent kalau udah pernah).

---

## File map (this push)

### BE
- `be/src/db/schema.ts`
- `be/src/db/migrate.ts`
- `be/src/db/dal.ts`
- `be/src/lib/crons.ts`
- `be/src/lib/payoutWeight.ts`
- `be/src/routes/votes.ts`
- `be/unit-test/payout/payoutWeight.test.ts`

### Docs (BE→FE handoff)
- `fe/docs/missIntegrateBe.md`
- `fe/docs/updateBe-08.md` (this file)
