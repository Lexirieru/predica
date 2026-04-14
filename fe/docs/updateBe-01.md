# BE Update Cycle 01

**Status:** 🟡 Unpushed — work in progress
**Branch:** `james`
**Started:** 2026-04-15

---

## 🎯 TL;DR — Yang Perlu FE Lakukan

| Action | File FE | Detail |
|--------|---------|--------|
| Refactor vote history → langsung pakai `marketSymbol` dari response, hapus fetch `/api/markets/all` | `src/app/profile/page.tsx` | [§Vote history enrichment](#4-vote-history-enrichment) |
| Call `GET /api/portfolio/:wallet/stats` buat PnL summary card di profile (winRate, roi, biggestWin, dll) | `src/app/profile/page.tsx` | [§Portfolio stats endpoint](#5-portfolio-stats-endpoint) |
| `/api/sentiment/:symbol` response **shape berubah** — handle field baru: `source`, `confidence`, `summary`, `refreshing` | `src/components/MarketCard.tsx` | [§LLM-backed sentiment](#6-llm-backed-sentiment) |

**Config changes:** optional `SENTIMENT_LLM_ENABLED=false` di BE env buat matiin LLM (hemat credit). Default `true`.
**Breaking changes:** sentiment response shape berubah, FE perlu adjust (detail di §6). Endpoint path sama.

---

## 🆕 Arsitektur baru: Polymarket-style timeline

**Ringkasan perubahan besar:**

- Satu symbol (BTC, ETH, dll) sekarang punya **N market** — satu untuk tiap 5-menit window. Pre-created 1 jam ke depan.
- Market punya status baru: `"upcoming"` (slot pre-created, belum buka untuk vote), `"active"` (slot sekarang, live), `"settled"` (sudah selesai).
- Candle OHLC sekarang **persistent di DB** — chart gak reset tiap market rotate.
- Endpoint baru `/api/markets/symbol/:SYMBOL` untuk render timeline tabs di FE.

**Yang perlu FE lakukan:**

| Action | File FE | Detail |
|--------|---------|--------|
| Chart: seed dari `/api/prices/candles/:symbol?window=1h` (atau 2h/6h/24h) — data persistent di BE sekarang | `src/hooks/useMarkets.ts` / chart init | [§Candle persistence](#8-candle-persistence) |
| Ganti `key={market.id}` → `key={market.symbol}` di `<PriceChart>` supaya chart gak remount tiap market rotate | `src/components/PriceChart.tsx` (parent) | [§Chart reset fix](#8-candle-persistence) |
| Bikin komponen timeline/tabs di bawah chart, data dari `GET /api/markets/symbol/:SYMBOL` | New component | [§Series endpoint](#10-series-endpoint) |
| Handle status `"upcoming"` — buckets ini belum bisa di-vote, tampilin sebagai outlined pills / "Opens at HH:MM" | Timeline component | [§Predefined buckets](#9-predefined-buckets) |
| Listener WS `NEW_MARKET` skrg trigger oleh activator juga (bukan cuma generator) — treat sebagai "bucket just went live" | WS handler | [§Predefined buckets](#9-predefined-buckets) |

---

## 📦 Commits

### Commit `34703eb` — 2026-04-15
**Title:** fix: address FE partner feedback from backendIssues.md

**Files:**
- `be/src/db/dal.ts`
- `be/src/lib/crons.ts`
- `be/src/routes/sentiment.ts`

#### 1. Sentiment scoring
`routes/sentiment.ts` — replace binary `engagement > 100` threshold dengan weighted score, saturasi di `engagement = 10`. Testnet low-volume sekarang produce `bullishPercent` yang meaningful, bukan selalu 0%.

#### 2. Settlement cron interval
`lib/crons.ts` — cron `"* * * * *"` → `"*/10 * * * * *"` (tiap 10s). Gap antara deadline expire dan resolusi turun dari 0-60s jadi 0-10s.

#### 3. Duplicate market guard
`lib/crons.ts` + `db/dal.ts` — `createMarketForSymbol` sekarang cek `marketRepo.hasActiveForSymbol` sebelum insert. Closes race condition antara settlement cron & generator yang produce 2x BTC / 2x SOL.

#### 4. Vote history enrichment
`db/dal.ts` — `voteRepo.getByUser` sekarang `leftJoin(markets)`. Response shape `/api/vote/user/:wallet`:
```ts
{
  id, marketId, userWallet, side, amount, payout, orderId,
  status, createdAt,
  // ↓ baru
  marketSymbol,        // e.g. "BTC"
  marketQuestion,      // "BTC Price: Higher or Lower in 5 min?"
  marketTargetPrice,
  marketResolution,    // "yes" | "no" | null
  marketDeadline,
  marketStatus,        // "active" | "settled"
}
```
FE gak perlu fetch `/api/markets/all` lagi cuma buat lookup symbol.

---

### Commit `c7dbdc7` — 2026-04-15
**Title:** feat: portfolio stats endpoint

**Files:**
- `be/src/db/dal.ts`
- `be/src/index.ts`
- `be/src/routes/portfolio.ts` (new)

#### 5. Portfolio stats endpoint
New endpoint: `GET /api/portfolio/:wallet/stats`

**Response shape:**
```ts
{
  wallet: string,
  balance: number,
  totalVotes: number,
  wins: number,
  losses: number,
  pending: number,              // vote yang belum resolved
  winRate: number,              // 0..1 (e.g. 0.62 = 62%)
  totalWagered: number,
  totalPnl: number,             // cumulative profit/loss
  roi: number,                  // totalPnl / totalWagered (0..∞)
  avgBet: number,
  biggestWin: number,           // max(payout - amount) where status=won
  biggestLoss: number,          // max(amount) where status=lost
  totalDeposits: number,
  totalWithdrawals: number,
}
```

**Zero-state:** kalau wallet belum pernah vote/deposit, endpoint return 200 dengan semua field = 0 (bukan 404). FE aman panggil tanpa null check.

**FE use case:**
- PnL summary card di profile page (winRate badge, ROI%, biggest win/loss tiles).
- Gak perlu hitung client-side dari vote array — lebih konsisten + hemat CPU.

**Catatan PnL chart:** response `/api/vote/user/:wallet` (enriched di §4) udah cukup buat build chart client-side. Sort by `createdAt` asc, running sum dari `status === 'won' ? payout - amount : status === 'lost' ? -amount : 0`. Filter today/week/month/all = simple `createdAt > threshold` di FE.

---

### Commit `fc4b1e1` — 2026-04-15
**Title:** feat: LLM-backed sentiment with stale-while-revalidate + smart seed

**Files:**
- `be/src/lib/sentimentCache.ts` (new)
- `be/src/lib/elfa.ts` (fix)
- `be/src/lib/crons.ts` (seed)
- `be/src/routes/sentiment.ts`
- `be/.env.example`

#### 6. LLM-backed sentiment
`GET /api/sentiment/:symbol` sekarang pake stale-while-revalidate:
- Cold call → return engagement proxy dalam ~200ms, background Elfa chat LLM refresh
- Warm call (dalam 5 menit) → instant cache hit dengan LLM sentiment beneran
- LLM call di-dedupe per symbol (single-flight), cache 5 min TTL

**Response shape baru:**
```ts
{
  symbol: "BTC",
  bullishPercent: 85,            // 0..100
  mentionCount: 10,
  source: "llm" | "engagement" | "neutral",
  confidence: "high" | "medium" | "low",
  summary?: string,              // Elfa LLM TL;DR, up to 500 chars
  topMentions?: [{ link, likes, reposts, views }],
  lastUpdated: 1776198...,       // epoch ms
  refreshing: boolean,           // BE lagi fetch LLM di background
}
```

**Breaking change buat FE:**
Response lama: `{ symbol, mentionCount, bullishPercent, topMentions }`
Response baru: extra fields `source`, `confidence`, `summary`, `lastUpdated`, `refreshing`.

Field lama masih ada — yang perlu update:
- Tampilin `confidence` sebagai visual cue (e.g. dot warna: hijau=high, kuning=medium, abu=low)
- `summary` → tooltip "AI analysis" di sentiment bar
- `refreshing: true` → subtle spinner/pulse animation "updating..."
- `source === "engagement"` → badge kecil "quick estimate" supaya user tau ini bukan LLM full

**Kenapa ini penting:**
Logic lama cuma ngukur engagement (popularitas), bukan sentiment. Tweet "BTC crashing" dengan 100 likes dulu dikira bullish. Sekarang Elfa chat mode `tokenAnalysis` beneran analisis semantic: parse "86.6% positive votes" atau bullish/bearish word ratio.

#### 7. Market seed sentiment (fix, no FE action)
`crons.ts generateMarketsFromTrending` dulu set `sentiment: 25 or 75` berdasarkan binary `change_percent > 0`. Sekarang pakai `seedSentiment()` — blend Pacifica price momentum (70%) + Elfa mention growth (30%), mapped ke 0..100. Market baru lahir udah punya seed yang masuk akal, nanti di-upgrade sama LLM saat pertama kali FE request sentiment endpoint.

---

### Commit `0ac09fb` — 2026-04-15
**Title:** feat: persist candle history to DB + multi-tier chart source

**Files:**
- `be/src/db/schema.ts` (new `candle_snapshots` table)
- `be/src/db/migrate.ts`
- `be/src/lib/candleCache.ts` (rewrite)
- `be/src/lib/crons.ts`
- `be/src/index.ts`
- `be/src/routes/prices.ts`

#### 8. Candle persistence
Chart "reset ke nol tiap market close" dulu karena candle data cuma in-memory. Sekarang:

- Tabel `candle_snapshots` PK `(symbol, interval, openTime)` — upsert tiap tick WS masuk, throttled 2s per symbol (tapi selalu langsung persist saat candle boundary baru, biar candle yang udah close gak ilang).
- Endpoint `GET /api/prices/candles/:symbol?window=1h|2h|6h|24h` — multi-tier source:
  1. Hot cache (in-memory, 60 candle terakhir)
  2. DB candle_snapshots
  3. Pacifica REST /kline (last resort)
- Response tambahan field `source` (`"cache"` | `"db"` | `"rest"`) + `window` untuk debugging.
- Warm cache on startup: BE baca DB untuk symbol yang lagi active → chart langsung punya data walaupun BE baru restart.
- Daily cleanup cron jam 03:15 UTC: prune candle lebih dari **2 hari** (`CANDLE_RETENTION_DAYS`).

**FE implication:**
- `fetchKline` lama bisa dihapus. Pakai `/api/prices/candles/:symbol?window=1h` untuk seed 60 candle.
- Chart `<PriceChart key={market.symbol} />` — kalau `key` masih `market.id`, React remount tiap market rotate → chart tetep reset walaupun data DB udah persistent. Wajib ganti ke `market.symbol`.
- Kalau lo mau chart yang "deeper history" (misal 24h), tinggal ganti query param — data-nya udah ada di DB.

---

### Commit `4618c93` — 2026-04-15
**Title:** feat: predefined time buckets + market activator + series endpoint

**Files:**
- `be/src/db/schema.ts` (`markets.status` enum expanded)
- `be/src/db/dal.ts`
- `be/src/lib/crons.ts`
- `be/src/lib/candleCache.ts`
- `be/src/routes/markets.ts`
- `be/src/index.ts`

#### 9. Predefined buckets
Generator `generateMarketsFromTrending` diganti `ensureUpcomingBuckets`:

- Untuk tiap curated symbol + top trending: pastiin **12 bucket upcoming** exist buat window 5-menit aligned ke clock boundary (:00, :05, :10, ...) selama 1 jam ke depan.
- Bucket baru di-create dengan `status: "upcoming"` dan `targetPrice: 0`.
- Idempotent — re-run skip `(symbol, deadline)` yang udah exist.

**Activator cron (baru, tiap 10s):**
- Find upcoming markets yang `deadline - 5min <= now` (= sudah masuk window-nya)
- Transition ke `active`, stamp `targetPrice = current_mark_price` saat itu juga
- Broadcast `NEW_MARKET` dengan payload activated (status active + targetPrice real)

**Kenapa dynamic targetPrice:**
Kalau pre-create market buat 09:00 sekarang (jam 08:00), `targetPrice` = current price 08:00 udah gak valid by 09:00. Activator solve ini dengan stamp on-demand.

**Vote flow:**
Vote endpoint udah check `market.status !== "active"` → reject. Jadi user gak bisa vote di bucket upcoming (by design). Kalau nanti mau pre-betting, bisa ditambahkan post-hackathon.

**FE implication:**
- `GET /api/markets` tetep return active only — feed utama gak berubah.
- Handle `status === "upcoming"` di UI kalau ambil data dari series endpoint: tampilin sebagai pill outlined "Opens at HH:MM", gak bisa di-click untuk vote.
- `NEW_MARKET` WS event sekarang bisa fired oleh **2 source**: generator (upcoming created) DAN activator (upcoming → active). FE bisa bedain pake `status` field di payload.

#### 10. Series endpoint
`GET /api/markets/symbol/:SYMBOL?past=12` return:
```ts
{
  symbol: "BTC",
  past: [                   // settled markets, OLDEST FIRST (timeline ascending)
    { id, deadline, targetPrice, resolution, yesPool, noPool, ... },
    ...
  ],
  live: {                   // current active market, nullable
    id, deadline, targetPrice, yesPool, noPool, currentPrice, ...
  } | null,
  upcoming: [               // future buckets, soonest first
    { id, deadline, targetPrice: 0, ... },
    ...
  ]
}
```

**FE use case:**
- Timeline tabs di bawah chart: `[...past, live, ...upcoming]` render jadi pills horizontal.
- Live = merah blink/glow indicator.
- Past = greyed + icon win/loss sesuai resolution.
- Upcoming = outlined + waktu "Opens at HH:MM".
- User klik past bucket → scroll chart ke timestamp itu (chart data udah coverage DB).

---

### Commit `b6f87f1` — 2026-04-15
**Title:** feat: require Pacifica ∩ Elfa-tracked for market generation

**Files:**
- `be/src/lib/elfaValidator.ts` (new)
- `be/src/lib/crons.ts`
- `be/src/index.ts`

#### 11. Symbol requirement: Pacifica AND Elfa
Market generator dulu accept symbol kalau ada di Pacifica — hasilnya NVDA/TSLA/GOOGL markets lolos (Pacifica list-nya) padahal Elfa `top-mentions?ticker=NVDA` return 0. Sentiment bar + activity feed permanently empty.

**Fix:** probe `top-mentions.metadata.total > 0` per candidate. Cache per symbol (1h TTL).

**Snapshot saat ini**: dari 24 curated, **14 lolos** (BTC, ETH, SOL, BNB, XRP, AVAX, LINK, AAVE, TON, NEAR, TAO, TRUMP, HYPE, PUMP). Sisanya (DOGE, ADA, SUI, LTC, ARB, UNI, JUP, WLD, BCH, XMR) currently tidak ada ticker mention di Elfa — auto-include lagi kalau Elfa pickup.

**FE impact:** **none**. Pool symbol berkurang dari ~24 jadi ~14 + trending aktif. FE cuma ngeliat lebih sedikit simbol muncul di feed. Sentiment bar sekarang guaranteed punya data nyata.

**Log baru saat boot:**
```
[ElfaValidity] Warmed 24 symbols. Tracked: 14 (BTC, ETH, SOL, ...)
```

---

### Commit `6835da9` — 2026-04-15
**Title:** fix: engagement proxy defaults to 50% when all mentions have zero likes

**Files:**
- `be/src/lib/sentimentCache.ts`

#### 12. Zero-engagement neutral default
Bug: symbol kayak TRUMP punya mentions di Elfa tapi semua `likeCount=0, repostCount=0` → engagement proxy kita output `0% bearish`, padahal itu cuma "no signal", bukan bearish.

**Fix:** tiga regime:
- No mentions → 50% neutral, source `"neutral"`
- Mentions ada tapi zero engagement → 50% neutral, source `"engagement"` (data ada, signal belum)
- Engagement > 0 → weighted score seperti sebelumnya

LLM SWR background tetap jalan — TRUMP ter-upgrade ke 27% bearish + summary setelah ~30s (tested).

**FE impact:** none (response shape sama).

---

<!-- Append new commits above this line. On push, replace the header status with:
     ✅ PUSHED: YYYY-MM-DD at commit {latest hash} — then stop editing this file. -->
