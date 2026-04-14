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

<!-- Append new commits above this line. On push, replace the header status with:
     ✅ PUSHED: YYYY-MM-DD at commit {latest hash} — then stop editing this file. -->
