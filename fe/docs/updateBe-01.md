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
| (opsional) Verify sentiment bar udah nunjukin angka > 0 di testnet | `src/components/MarketCard.tsx` | [§Sentiment scoring](#1-sentiment-scoring) |

**Config changes:** none.
**Breaking changes:** none (hanya nambah field + endpoint baru, gak ngilangin yang lama).

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

<!-- Append new commits above this line. On push, replace the header status with:
     ✅ PUSHED: YYYY-MM-DD at commit {latest hash} — then stop editing this file. -->
