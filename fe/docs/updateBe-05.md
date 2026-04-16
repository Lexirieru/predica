# BE Update Cycle 05

**Status:** ✅ PUSHED — 2026-04-16 (sealed at `1c94747`)
**Branch:** `james`
**Started:** 2026-04-16
**Sealed:** 2026-04-16

---

## 🎯 TL;DR — Yang Perlu FE Lakukan

| Action | File FE | Detail |
|--------|---------|--------|
| Preview share weight di TradeModal sebelum user konfirmasi bet | `src/components/TradeModal.tsx` (sudah dikerjakan) | [§Hybrid payout weight](#hybrid-payout-weight) |
| (Opsional) Tampilkan badge "late bet" di vote history profile | `src/app/profile/page.tsx` | Field baru `shareWeight` di response `/api/vote/user/:wallet` |

**Breaking:** Response `/api/vote` POST sekarang nambah field `shareWeight` (additive).

---

## 📦 Commits

### (unpushed) — 2026-04-16
**Title:** feat: hybrid pari-mutuel + late-bet weight penalty

**Files BE:**
- `be/src/lib/payoutWeight.ts` (new — pure math)
- `be/unit-test/payout/payoutWeight.test.ts` (14 tests)
- `be/unit-test/payout/computePayouts.test.ts` (7 tests)
- `be/src/db/schema.ts` (new `share_weight` column on `votes`)
- `be/src/db/migrate.ts` (additive ALTER TABLE default 0)
- `be/src/db/dal.ts` (`voteRepo.create` accepts shareWeight)
- `be/src/routes/votes.ts` (compute weight at insert time)
- `be/src/lib/crons.ts` (settlement uses weighted split via `computePayouts`)

**Files FE:**
- `fe/src/lib/payoutWeight.ts` (new — mirror BE math for live preview)
- `fe/src/components/TradeModal.tsx` (weight preview banner)

## Hybrid payout weight

### Problem

Pure pari-mutuel pool bocor nilai pas detik-detik terakhir. Contoh: BTC market, sisa 30 detik, price jelas UP. YES pool $100, NO pool $100. Whale bet $1000 YES, pool jadi $1100 / $100. Whale share = 1000/1100 ≈ 91%, payout = 91% × $1200 = $1091. **Profit ~$91 dari modal $1000 = 9% ROI hampir-pasti** — arbitrase near-risk-free.

Polymarket ga punya masalah ini karena order book auto-defensive (price udah nempel $1 kalau outcome jelas). Kita pakai pool, jadi harus apply defense manual.

### Solution — weighted share at settlement

Tiap vote punya `share_weight` yang dihitung pas vote di-insert, berdasarkan:
- **Implied probability sisi yang di-bet**, pool state SEBELUM vote ini masuk
- **Time fraction tersisa** (1.0 di market open, 0.0 di deadline)

**Formula:**

```
weight = clamp(1 - (1 - timeFraction) × max(0, 2p - 1), 0.1, 1)
```

Di mana `p` = implied probability of target side.

### Contoh hasil

| Skenario | p (target) | Time remaining | Weight |
|----------|------------|----------------|--------|
| First bet, market kosong | 0.5 (symmetric) | any | **1.00** |
| Pool 50-50 | 0.5 | any | **1.00** |
| Bet underdog (p < 0.5) | any | any | **1.00** |
| 75% favorite, market open | 0.75 | 100% | **1.00** |
| 75% favorite, halfway | 0.75 | 50% | **0.75** |
| 75% favorite, deadline | 0.75 | 0% | **0.50** |
| 99% favorite, 10% remaining | 0.99 | 10% | **0.118** |
| 100% favorite, deadline | 1.0 | 0% | **0.10** (floor) |

### Payout split

Waktu settlement, **losing pool** tetep distribusi full ke winners (ga ada "leak"), tapi share per winner dihitung `shareWeight / Σwinners.shareWeight` (bukan `amount / Σamount`).

Efeknya: late-whale ke favorit dapet proportionally kurang; early bettors + underdog bettors dapet relatively lebih. Total pool tetep = total stake (100% conservation).

### Fallback legacy

Kalau ada winner dengan `shareWeight == 0` (row lama pre-migration), settlement **revert ke amount-weighted** buat SELURUH market. Biar ga ada rasa ga fair antara vote lama dan baru dalam market yang sama.

### Worked example — yang ada di test

Setup:
- 10 early bettor × $10 YES (weight 1.0 semua karena market masih kosong/balanced)
- 1 late whale $1000 YES saat pool udah 100 YES / 50 NO, 5% time remaining
  - p = 100/150 = 0.667, urgency = 0.95, favoriteBias = 0.333
  - weight = 1 - 0.95 × 0.333 = **0.683**
  - shareWeight = 1000 × 0.683 = **683**
- 1 loser $200 NO

**Amount-weighted (pre-hybrid):** whale share = 1000/1100 = 91% → payout $1182, early total $118

**Weighted (hybrid):** whale share = 683/(100+683) ≈ 87% → payout $1130, early total $170

Whale dapet **$52 less**, early bettors collective dapet **$52 more**. Magnitude sedang, bukan punitive. Pool tetep $1300 total (conservation).

### FE preview

`fe/src/lib/payoutWeight.ts` = mirror pure function. Dipanggil di TradeModal buat nunjukin "Your effective stake will be $Xx (Y% share)" banner SEBELUM user konfirmasi. Re-tick tiap detik biar user liat weight shrinking kalo dia lama-lamain.

**Breaking change di response `POST /api/vote`:** additive field `shareWeight: number`. Existing payload structure unchanged.

### WS event update

`NEW_VOTE` broadcast sekarang carry `shareWeight` juga, jadi FE bisa render "late-bet badge" di activity feed kalo mau.

```ts
// Before
{ marketId, side, amount, wallet }
// After
{ marketId, side, amount, wallet, shareWeight }
```

FE `useMarkets.ts` ga perlu update kalau ga mau pakai — field additive.

---

## Tests

```
be/unit-test/payout/
  payoutWeight.test.ts      — 14 tests pure weight formula
  computePayouts.test.ts    —  7 tests settlement payout math
```

Cover:
- No-penalty zones (empty market, balanced pool, underdog, market open)
- Graded penalty (75% favorite at various times)
- Floor clamp (99% favorite near deadline)
- Monotonicity (weight non-increasing in elapsed time)
- Realistic late-whale scenario
- Legacy fallback to amount-weighted
- No winners edge case
- Conservation (total payout = total pool)

Semua 40 test suite passed (21 baru + 19 existing).
