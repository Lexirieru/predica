# BE Update Cycle 07

**Status:** 🟡 UNPUSHED
**Branch:** `james`
**Started:** 2026-04-16
**Sealed:** —

---

## 🎯 TL;DR — Yang Perlu FE Lakukan

Tidak ada — FE udah di-clean bareng BE di cycle ini. Partner FE yang punya checkout terpisah **wajib** rebase sebelum lanjut kerja: field `durationMin` dihapus total dari contract.

| Change | Detail |
|--------|--------|
| Field `durationMin` dihapus dari API response, BE schema, FE types | Semua konsumsi 5-minute literal / `5*60_000` ms. Kalau FE branch lain masih baca `market.durationMin`, bakal ga-ada-di-type (compile error) — itu intended, bukan bug |
| Market generator single-cadence | `MARKET_DURATIONS` array + `DurationConfig` type hilang. Satu loop, satu horizon |
| `GET /api/markets/symbol/:SYMBOL` — query param `durationMin` tidak pernah shipped | Sempet direncanain di session lalu, tapi di-revert sebelum commit. Aman |

**Breaking:** `durationMin` field removed from `PredictionMarket` DTO. FE consumer yang explicit baca field-nya harus update atau drop reference. Dalam repo ini udah di-handle semua.

---

## 📦 Commits

### (unpushed) — 2026-04-16
**Title:** refactor: drop duration variety — all markets fixed 5 min

### Konteks

Session lalu (`de487dc fix: market interval`) partially revert `MARKET_DURATIONS` ke 5m-only, tapi masih ninggalin jejak:
- Column `duration_min` di schema.ts
- Param `durationMin` di `getBySymbolDeadline` + `computeShareWeight`
- Field `durationMin` di FE `PredictionMarket` type + mappers
- Badge styling 1m/15m di MarketCard
- Test cases untuk duration 1/15 di payoutWeight

Cycle ini nge-bersihin sisa-sisa itu supaya codebase ga ninggalin dead code + misleading types.

### BE changes

- `be/src/db/schema.ts` — drop column `durationMin` dari `markets` table.
- `be/src/db/migrate.ts` — hapus `ALTER TABLE markets ADD COLUMN IF NOT EXISTS duration_min …`.
- `be/src/db/dal.ts`:
  - `getBySymbolDeadline(symbol, deadline)` — drop third param. Idempotency sekarang scoped ke `(symbol, deadline)` saja.
  - `getDueForActivation(now)` — hardcode 5min open-time window (`deadline - 300000`).
- `be/src/lib/crons.ts`:
  - Hapus `type DurationConfig`, `const MARKET_DURATIONS`.
  - Ganti dengan `MARKET_DURATION_MIN = 5` / `SLOT_MS` / `HORIZON_MS = 60min` konstan.
  - `createBucket(symbol, deadline, sentiment, prices)` — drop `durationMin` param.
  - `ensureUpcomingBuckets` single-loop (sebelumnya outer loop per-duration).
  - Activator cron pake `SLOT_MS` konstan, drop `m.durationMin`.
- `be/src/lib/payoutWeight.ts` — drop `durationMin` dari `WeightInputs`. Formula pake konstan `MARKET_DURATION_MS = 5*60_000`.
- `be/src/routes/votes.ts` — drop `durationMin` dari `computeShareWeight` call.
- `be/unit-test/payout/payoutWeight.test.ts` — strip `durationMin:` dari semua test fixtures. Hapus test "different duration values work (1m and 15m)". 13/13 masih passed.

### FE changes

- `fe/src/lib/types.ts` — drop `durationMin` field dari `PredictionMarket`.
- `fe/src/lib/api.ts` — drop mapping `durationMin: Number(raw.durationMin ?? raw.duration_min ?? 5)` di `mapMarket`.
- `fe/src/hooks/useMarkets.ts` — drop mapping di WS NEW_MARKET handler. Update stale comment soal "1m/5m/15m buckets".
- `fe/src/lib/payoutWeight.ts` — drop `durationMin` dari `WeightInputs`. Pake `MARKET_DURATION_MS = 5*60_000` konstan — mirror BE.
- `fe/src/components/TradeModal.tsx` — drop `durationMin: market.durationMin` dari `computeShareWeight` call.
- `fe/src/components/BucketPill.tsx` — `market.durationMin * 60_000` → `5 * 60_000` literal.
- `fe/src/components/MarketCard.tsx`:
  - Candle window fetch: `selectedBucket.durationMin * 60_000` → `5 * 60_000`.
  - Countdown timer: `windowMs` compute pake `5 * 60_000`, drop `market.durationMin` dari dep array.
  - Badge: hapus branch `durationMin === 1/15` color + hapus conditional "1 Minute"/"Minutes" copy. Selalu "5m" / "5 Minutes".

### Docs

- `fe/docs/missIntegrateBe.md` section 18 "Market Duration" — update biar FE partner tau field udah dihapus total (bukan cuma "jangan pake 1m/15m lagi").

---

## Root cause recap

Knp variety bisa nyelonong balik padahal user pernah bilang fixed 5m:
1. `updateBe-03` (cycle yang udah sealed) introduce 1m/15m variety dengan note "breaking: none" karena additive field.
2. User punya product decision "fixed 5 min" yang belum sync ke semua kontributor — dicatet di `missIntegrateBe.md` section 18 tapi kurang explicit.
3. Cycle 03 berjalan, kolom `duration_min` + FE badge styling terlanjur nyangkut di codebase.
4. Timeline 1-menit di UI (screenshot 7:29/7:30/7:31 user) jadi smoking gun.

Mitigation biar ga keulang: memory `feedback_fixed_5min_duration.md` udah disimpan + section 18 di-update jelas.

---

## Tests

- `bunx tsc --noEmit` (BE) — 2 error pre-existing di `elfaValidator.ts:29` + `sentimentCache.ts:48` soal response typing. Bukan regression cycle ini.
- `bunx tsc --noEmit` (FE) — 0 error.
- `bunx jest` — 39/39 pass across 7 suites. Payout test 13/13 pass.
- Manual: `bun run dev` startup bersih, `[Buckets] Pre-created N upcoming 5m buckets across M symbols.` log muncul; activator pop di 5-min boundary.

---

## File map

### BE
- `be/src/db/schema.ts`
- `be/src/db/migrate.ts`
- `be/src/db/dal.ts`
- `be/src/lib/crons.ts`
- `be/src/lib/payoutWeight.ts`
- `be/src/routes/votes.ts`
- `be/unit-test/payout/payoutWeight.test.ts`

### FE
- `fe/src/lib/types.ts`
- `fe/src/lib/api.ts`
- `fe/src/lib/payoutWeight.ts`
- `fe/src/hooks/useMarkets.ts`
- `fe/src/components/TradeModal.tsx`
- `fe/src/components/BucketPill.tsx`
- `fe/src/components/MarketCard.tsx`

### Docs
- `fe/docs/missIntegrateBe.md`
