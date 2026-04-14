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

<!-- Append new commits above this line. On push, replace the header status with:
     ✅ PUSHED: YYYY-MM-DD at commit {latest hash} — then stop editing this file. -->
