# BE Update Cycle 02

**Status:** 🟡 Unpushed — work in progress
**Branch:** `james`
**Started:** 2026-04-15

---

## 🎯 TL;DR — Yang Perlu FE Lakukan

| Action | File FE | Detail |
|--------|---------|--------|
| Listen WS `BADGE_UNLOCKED` → tampilin toast "🔥 First Win unlocked!" | `src/hooks/useMarkets.ts` atau global handler | [§Achievements system](#1-achievements--badges) |
| Tampilin badge collection di profile page (grid icon locked/unlocked) | `src/app/profile/page.tsx` | [§Achievements system](#1-achievements--badges) |
| Render hype meter sparkline di market card dari `/api/markets/:id/hype` | `src/components/MarketCard.tsx` (new component `HypeMeter`) | [§Hype meter](#2-hype-meter) |

**Config changes:** none
**Breaking changes:** none

---

## 📦 Commits

### Commit `e073228` — 2026-04-15
**Title:** feat: achievements / badges system

**Files:**
- `be/src/db/schema.ts` (new `achievements` table)
- `be/src/db/migrate.ts`
- `be/src/lib/achievements.ts` (new)
- `be/src/lib/crons.ts` (hook into settlement)
- `be/src/lib/websocket.ts` (new `BADGE_UNLOCKED` type)
- `be/src/routes/achievements.ts` (new)
- `be/src/index.ts`

#### 1. Achievements / Badges
Gamification layer. 8 badge types:

| Type | Label | Emoji | Trigger |
|------|-------|-------|---------|
| `FIRST_WIN` | First Win | 🔥 | First won market |
| `STREAK_3` | On Fire | ⚡ | 3 wins in a row |
| `STREAK_5` | Unstoppable | 🌟 | 5 wins in a row |
| `STREAK_10` | Oracle | 👑 | 10 wins in a row |
| `SHARPSHOOTER` | Sharpshooter | 🎯 | 70%+ win rate with 10+ settled votes |
| `HIGH_ROLLER` | High Roller | 💎 | Single bet ≥ $100 |
| `MOONSHOT` | Moonshot | 🚀 | Single win payout ≥ $500 |
| `CENTURION` | Centurion | 🏛️ | 100 total votes |

**Endpoint baru:**

`GET /api/achievements` — katalog semua badge (FE pake buat render grid lock/unlock):
```ts
{
  badges: [
    { type: "FIRST_WIN", label: "First Win", emoji: "🔥", description: "Won your first market" },
    ...
  ]
}
```

`GET /api/achievements/:wallet` — yang udah unlock:
```ts
{
  wallet: "7Xyz...",
  unlocked: [
    {
      id: "uuid",
      type: "STREAK_3",
      label: "On Fire",
      emoji: "⚡",
      description: "Won 3 markets in a row",
      unlockedAt: 1776198000000,
      metadata: { streak: 3 }
    }
  ]
}
```

**WS event baru — `BADGE_UNLOCKED`:**
Fired tiap user dapet badge baru (setelah market resolve):
```ts
{
  type: "BADGE_UNLOCKED",
  data: {
    wallet: "7Xyz...",
    badge: {
      type: "STREAK_3",
      label: "On Fire",
      emoji: "⚡",
      description: "Won 3 markets in a row"
    },
    metadata: { streak: 3 },
    unlockedAt: 1776198000000
  },
  timestamp: ...
}
```

**FE integration suggestion:**
- Global WS handler listen `BADGE_UNLOCKED` → filter `data.wallet === currentUserWallet` → show toast dengan animation (confetti / glow). Partner bisa pake library `react-hot-toast` atau custom.
- Profile page: fetch `/api/achievements` + `/api/achievements/:wallet`, render grid:
  - Locked badges: greyed emoji + label, tooltip with description
  - Unlocked badges: colorful + "Unlocked {date}"
- Optional: leaderboard / card badge — partner bebas.

### Commit `efa1747` — 2026-04-15
**Title:** feat: hype meter endpoint — vote ratio timeline per market

**Files:**
- `be/src/db/dal.ts`
- `be/src/routes/markets.ts`

#### 2. Hype Meter
Polymarket-style hype meter: shows how crowd sentiment (yes vs no vote ratio) shifts through the market's lifetime.

**Endpoint baru:** `GET /api/markets/:id/hype`

**Response:**
```ts
{
  marketId: "abc-123",
  symbol: "BTC",
  status: "active",
  current: {
    yesShare: 0.62,        // 0..1
    noShare: 0.38,
    yesPool: 125.4,        // $USDP
    noPool: 76.8,
    totalVoters: 18,
  },
  timeline: [
    // Ascending-time points, one per vote
    { t: 1776200000000, yesShare: 0.50, noShare: 0.50, yesPool: 5, noPool: 5, totalVotes: 2 },
    { t: 1776200060000, yesShare: 0.66, noShare: 0.34, yesPool: 10, noPool: 5, totalVotes: 3 },
    ...
  ]
}
```

**FE rendering suggestion:**
- Horizontal bar under chart: `yesShare` = hijau, `noShare` = merah. Width proportional.
- Label: "62% UP · 38% DOWN" atau similar.
- Mini sparkline di samping bar (width ~60px, height ~20px): timeline `yesShare` point over time — biar user liat trend (stable? swung?).
- Kalau `timeline.length === 0`, tampilin "Be the first to bet" state.
- **No auto-refresh needed** — market card udah subscribe `NEW_VOTE` WS → pool amounts update → compute current share client-side. Call hype endpoint hanya buat initial timeline seed.

**Library suggestion:** pakai `lightweight-charts` yang udah ada (tiny area chart, hide axes) atau custom SVG polyline untuk sparkline kecil.
