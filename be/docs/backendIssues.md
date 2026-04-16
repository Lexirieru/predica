# Backend Issues — From FE Testing

Dokumen dari FE partner setelah testing integrasi. List bug dan improvement yang perlu di-fix di BE.

**Tester:** Axel (FE)
**Date:** 2026-04-15
**Branch:** main

---

## Priority Summary

| Prio | Issue | File | Effort | Impact |
|------|-------|------|--------|--------|
| **P0** | Elfa AI sentiment selalu 0% | `routes/sentiment.ts` | XS | UX — sentiment bar useless |
| **P0** | Settlement cron gap 30-60s | `lib/crons.ts` | XS | UX — user lihat 00:00 stuck |
| **P1** | Duplicate markets (symbol sama) | `lib/crons.ts` | S | Data — 2x BTC, 2x ETH di feed |
| **P2** | Vote endpoint: include market symbol di response | `db/dal.ts` | XS | UX — profile vote history butuh symbol |

XS = <30min, S = <2h, M = <1d

---

## 1. Elfa AI Sentiment Selalu 0% (P0)

**File:** `be/src/routes/sentiment.ts:17-21`

**Problem:** `bullishPercent` dihitung dari mentions yang punya `engagement > 100` (likes + reposts*2). Tapi Elfa API return mentions dengan engagement sangat rendah (0-1 likes). Jadi `positiveSignals` selalu 0 → `bullishPercent` selalu 0%.

**Current logic:**
```ts
for (const m of data.slice(0, 20)) {
  const engagement = (m.likeCount || 0) + (m.repostCount || 0) * 2;
  totalEngagement += engagement;
  if (engagement > 100) positiveSignals++;  // ← threshold terlalu tinggi
}
```

**Evidence:**
```bash
curl -s http://localhost:3001/api/sentiment/BTC | python3 -m json.tool
# → bullishPercent: 0, mentionCount: 10
# Top mentions semua punya 0-1 likes
```

**Fix options:**
1. Turunkan threshold ke `> 0` (any engagement = positive signal)
2. Atau lebih baik: hitung weighted sentiment dari ratio engagement (bukan binary threshold)
3. Atau paling ideal: cek apakah Elfa API punya `sentimentScore` field di response dan pakai langsung

**Impact di FE:** MarketCard sentiment bar selalu "0% Bearish" (merah) → misleading.

---

## 2. Settlement Cron Gap 30-60 Detik (P0)

**File:** `be/src/lib/crons.ts:23`

**Problem:** Settlement cron jalan `"* * * * *"` (setiap menit). Setelah market expire, ada gap sampai 60 detik dimana:
- Market status masih "active" di DB
- FE tampilkan countdown 00:00
- User gabisa vote (disabled) tapi market belum di-settle
- FE sekarang filter expired markets dan tampilkan "Waiting for new markets..."

**Fix:** Jalankan settlement cron lebih sering, misal setiap 10 detik:
```ts
// Ganti:
cron.schedule("* * * * *", async () => { ... });

// Jadi (pakai node-cron seconds mode):
cron.schedule("*/10 * * * * *", async () => { ... });
```

Atau pakai `setInterval(settle, 10_000)` kalau `node-cron` seconds mode ribet.

**Note:** `isSettling` mutex sudah ada, jadi concurrent calls aman.

---

## 3. Duplicate Markets — Symbol Sama (P1)

**File:** `be/src/lib/crons.ts:293-308`

**Problem:** Market generator cron (`*/5 * * * *`) create batch baru setiap 5 menit. Tapi kalau batch sebelumnya belum expired (masih active), `pickedSymbols` filter mencegah duplikat. **Tapi** kalau timing pas: settlement jalan → old markets di-settle → generator jalan → old markets sudah "settled" jadi gak masuk `getActive()` → tapi kadang race condition bikin 2 batch aktif bersamaan.

**Evidence dari API:**
```
SOL  status=active  diff=180s  id=24e5ef6b
SOL  status=active  diff=180s  id=84a8150e  ← duplicate
BTC  status=active  diff=181s  id=9b972ba7
BTC  status=active  diff=181s  id=06411227  ← duplicate
```

**Fix options:**
1. Sebelum `createMarketForSymbol`, cek apakah sudah ada active market untuk symbol itu:
   ```ts
   const existing = activeMarkets.find(m => m.symbol.toUpperCase() === symbol);
   if (existing) continue;
   ```
2. Atau tambah unique constraint di DB: `UNIQUE(symbol, status)` where status = 'active'
3. Atau `getActive()` di generator harus di-refresh setelah settlement selesai

---

## 4. Vote Response: Include Market Symbol (P2)

**File:** `be/src/db/dal.ts:128-133`

**Problem:** `voteRepo.getByUser()` return vote rows tanpa market symbol. FE profile page perlu tahu symbol untuk tampilkan "BTC Up" / "ETH Down" di vote history.

**Current:** FE harus fetch `/api/markets/all` (200 markets) cuma untuk build symbol map — wasteful.

**Fix:** Join votes dengan markets table:
```ts
async getByUser(wallet: string) {
  return await db
    .select({
      id: votes.id,
      marketId: votes.marketId,
      side: votes.side,
      amount: votes.amount,
      payout: votes.payout,
      status: votes.status,
      createdAt: votes.createdAt,
      symbol: markets.symbol,  // ← tambah ini
    })
    .from(votes)
    .leftJoin(markets, eq(votes.marketId, markets.id))
    .where(eq(votes.userWallet, wallet))
    .orderBy(desc(votes.createdAt));
}
```

---

## Context: What FE Already Fixed

Biar gak double work, ini yang sudah di-handle di FE:

| Issue | Fix di FE |
|-------|-----------|
| Auth headers missing (vote gagal) | TradeModal sekarang sign `Predica Auth: VOTE by {wallet} at {timestamp}` via wallet, kirim `x-signature` + `x-timestamp` headers |
| Field naming mismatch (camelCase vs snake_case) | Profile + Leaderboard page di-fix pakai camelCase (`totalVotes`, `createdAt`, dll) sesuai Drizzle response |
| Market status "settled" vs "resolved" | FE check both: `market.status === "resolved" \|\| market.status === "settled"` |
| Expired markets stuck di feed | FE filter `deadline > Date.now()` + tampilkan "Waiting for new markets..." |
| Chart break setelah 5 menit | Added `key={market.id}` ke PriceChart supaya remount saat market berubah |
| SwipeStack shuffle saat NEW_MARKET | NEW_MARKET append (bukan prepend) + index stabilization |
