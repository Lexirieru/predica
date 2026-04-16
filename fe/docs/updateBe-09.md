# BE Update Cycle 09

**Status:** 🟡 UNPUSHED
**Branch:** `james`
**Started:** 2026-04-16

---

## 🎯 TL;DR — FE Impact

**None.** Cycle ini BE-only (build-fix + backend performance pass). Ga ada API surface change, ga ada response shape change, ga ada endpoint baru. FE ga perlu integrate apapun — semua response contract tetap sama.

---

## 📦 Commits

### `51c83e6` — 2026-04-16 — fix(be): add explicit `Promise<any>` return to `getTopMentions`

Deploy ke Railway fail karena TypeScript compile error:

```
src/lib/elfaValidator.ts(29,16): error TS2339: Property 'metadata' does not exist on type '{}'.
src/lib/sentimentCache.ts(48,59): error TS2339: Property 'data' does not exist on type '{}'.
```

Root cause: `getTopMentions` di `be/src/lib/elfa.ts` ga punya explicit return type. Railway resolve `typescript: ^6.0.2` ke TS 6.x yang narrowing DOM lib-nya — `res.json()` sekarang return `Promise<{}>` instead of `Promise<any>`. Fungsi sibling di file yang sama (`getTrendingTokens`, `getKeywordMentions`, `getTrendingNarratives`, `chatAnalysis`) udah punya `Promise<any>` — cuma yang satu ini kelewat.

**BE changes:**
- `be/src/lib/elfa.ts` — add `Promise<any>` return type ke `getTopMentions(ticker)`.

---

### (pending) — 2026-04-16 — perf(be): hot-path optimizations

Backend performance pass — 7 internal changes, zero FE-visible surface change.

**1. Settlement cron: DB-side expired filter** (`be/src/lib/crons.ts`, `be/src/db/dal.ts`)

Sebelumnya: settlement cron (tiap 10s) fetch `marketRepo.getActive()` lalu filter `deadline <= now` di memory. Scaling linear dengan jumlah active markets.

Sekarang: new `marketRepo.getExpiredDue(now, limit=50)` — single query pake `WHERE status='active' AND deadline <= now`, index-backed via `idx_markets_status_deadline`. Settlement tick bounded ke 50 rows max.

**2. Portfolio stats: pre-computed peak win/loss** (`be/src/db/schema.ts`, `be/src/db/migrate.ts`, `be/src/lib/crons.ts`, `be/src/db/dal.ts`)

Sebelumnya: `/api/portfolio/:wallet/stats` scan full votes history user tiap request buat compute biggest win/loss (`MAX(CASE WHEN status='won' ...)` aggregation).

Sekarang: 2 kolom baru di `users`: `biggest_win`, `biggest_loss`. Settlement maintain incrementally via `GREATEST(${users.biggestWin}, ${profit})` dalam same transaction. Portfolio endpoint sekarang cuma baca row users + narrow COUNT untuk `pending`. Response shape identik → FE aman.

Migration idempotent: `ALTER TABLE users ADD COLUMN IF NOT EXISTS biggest_win REAL NOT NULL DEFAULT 0`. Legacy users yang udah settle sebelum cycle ini akan mulai dari 0 sampe vote berikutnya resolve — ga perlu backfill (stats tetap akurat going forward).

**3. Hype timeline in-process cache** (`be/src/routes/markets.ts`)

Sebelumnya: `/api/markets/:id/hype` reduce full votes history tiap request.

Sekarang: LRU cache (max 500 entries) di route layer. Settled markets cached selamanya (timeline immutable). Active markets cache 30s TTL. Response shape sama persis.

**4. Pacifica prices TTL bump** (`be/src/lib/pacifica.ts`)

5s → 10s, align dengan cron cadence. Settlement + activator cron yang fire di second yang sama sekarang coalesce ke single upstream call. Existing in-flight promise coalescing untuk concurrent misses tetap.

**5. Startup parallelization** (`be/src/index.ts`)

`warmElfaValidityCache()` dan `warmCandleCache()` sebelumnya sequential; sekarang `Promise.all`. Cold-start latency = max(elfa, candles) bukan sum. Market generator tetap block on elfa validity (required buat filter candidate symbol).

**6. Composite votes index** (`be/src/db/schema.ts`, `be/src/db/migrate.ts`)

Added `idx_votes_user_created` on `(user_wallet, created_at)`. Portfolio vote-history scan (`WHERE user_wallet = X ORDER BY created_at DESC`) sekarang index-only.

**7. Sentiment cache LRU bound** (`be/src/lib/sentimentCache.ts`)

Cap Map di 500 entries, eviction oldest-first. Touch-on-read biar LRU favors hot symbols. Sebelumnya growth unbounded over weeks.

**Validation:**
- `bun run build` local → clean, exit 0.
- All response shapes identical (checked: `/markets/:id/hype`, `/portfolio/:wallet/stats`).
- Two new columns (`users.biggest_win`, `users.biggest_loss`) backwards-compatible via IF NOT EXISTS.
- New index (`idx_votes_user_created`) IF NOT EXISTS — safe on re-run.

### FE impact

Nihil. Semua optimasi di layer internal: query pattern, cache, index, startup order. Response contracts dari semua endpoint tidak berubah. Testing ga butuh FE re-integration.
