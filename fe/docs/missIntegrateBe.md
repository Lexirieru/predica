# FE ↔ BE Integration Gaps

Dokumen handoff untuk partner FE. List semua gap integrasi, mock/hardcoded data, dan perubahan BE yang perlu di-sync ke FE.

**Target branch:** `james`
**Last full audit:** 2026-04-14

---

## 0. TL;DR — Priority Summary

| Prio | Item | Effort | Impact |
|------|------|--------|--------|
| **P0** | Implement WS client (`useWebSocket` hook) — foundation semua realtime features | M | Critical |
| **P0** | Subscribe `MARKET_RESOLVED` → tampilin resolution banner | S | Critical UX |
| **P0** | Subscribe `NEW_VOTE` → ganti activity feed fake dengan real trades | S | Critical UX |
| **P1** | Subscribe `PRICE_UPDATE` → hapus polling `fetchPrices` 1s | S | Perf |
| **P1** | Switch chart ke `/api/prices/candles/:symbol` + `CANDLE_UPDATE` | M | Accuracy |
| **P1** | Subscribe `NEW_MARKET` → auto-insert ke feed | S | UX |
| **P1** | Deposit modal: validate on-chain USDP balance | S | UX + error prevention |
| **P1** | Remove random padding di voter count | XS | Data honesty |
| **P1** | Upgrade line chart → candlestick (`lightweight-charts`) | M | "Trading feel" |
| **P2** | Sentiment polling (`/api/sentiment/:symbol`) | S | Data freshness |
| **P2** | Leaderboard polling (30-60s) | XS | Freshness |
| **P2** | Balance sync across pages (Zustand) | S | Consistency |
| **P2** | Vote history auto-refresh di profile | XS | Freshness |
| **P2** | Withdraw TX explorer link | XS | Transparency |
| **P2** | Transaction history page (`/api/wallet/transactions/:address`) | M | Feature |
| **P2** | Move hardcoded values ke env var (RPC, USDP_MINT, BACKEND_WALLET) | XS | Config hygiene |
| **P3** | Category filtering (Explore) | S | Feature |
| **P3** | Leaderboard pagination | S | Scale |
| **P3** | Trending token badge (`/api/sentiment` tanpa symbol) | S | Discovery |
| **P3** | Auth signature wiring (tunggu BE) | L | Security |

XS = <1h, S = <2h, M = <1d, L = >1d

---

## 1. WebSocket Client — FOUNDATION (P0)

**Status BE:** WS server jalan di `ws://localhost:3001` (otomatis upgrade dari HTTP port yang sama). Broadcasting message types:
- `PRICE_UPDATE` — realtime price dari Pacifica WS
- `CANDLE_UPDATE` — 1m mark-price candle per symbol aktif
- `NEW_MARKET` — tiap market baru di-generate
- `MARKET_RESOLVED` — tiap market di-settle
- `NEW_VOTE` — tiap user vote

**Status FE:** ❌ **Belum ada koneksi WS sama sekali.** Semua realtime masih via REST polling.

**Yang perlu dibangun:**

Buat `fe/src/hooks/useWebSocket.ts` dan `fe/src/lib/ws-client.ts` — singleton WS connection dengan:
- Auto-reconnect dengan exponential backoff
- Heartbeat PING/PONG setiap 30s (BE handle `PING` message type, respond `PONG`)
- Event dispatcher: `subscribe(type, callback)` pattern

**Payload shape dari BE** (`be/src/lib/websocket.ts`):
```ts
{
  type: "PRICE_UPDATE" | "CANDLE_UPDATE" | "NEW_MARKET" | "MARKET_RESOLVED" | "NEW_VOTE",
  data: any,        // shape depends on type — see sections below
  timestamp: number
}
```

**Env var baru:** `NEXT_PUBLIC_WS_URL=ws://localhost:3001`

---

## 2. Realtime Price — Replace Polling (P1)

**Current (FE):** `useMarkets.ts:90` polling `fetchPrices()` tiap 1 detik via HTTP.

**Fix:**
- Hapus `setInterval(refreshPrices, 1000)`
- Listen `PRICE_UPDATE` → update `market.currentPrice` + push ke `priceHistory`
- Payload: `{ BTC: 105473.2, ETH: 3421.5, ... }` (map symbol → mark price)

**Benefit:** Sub-second latency, no HTTP overhead.

---

## 3. Chart / Candle Stream (P0-P1)

**Status BE:** Pacifica `mark_price_candle` WS sudah subscribed per symbol aktif (1m interval). Backend:
- Cache 60 candle terakhir per symbol di-memory (`candleCache.ts`)
- Broadcast `CANDLE_UPDATE` tiap tick
- Kenapa mark price (bukan trade): settlement pakai mark price — kalau chart pake trade candle, bisa divergen → user liat chart hijau tapi settle kalah. **Mark candle = chart close persis sama dengan settlement price.**

**Current (FE):** 
- `api.ts:53-66` — fetch `/api/prices/kline/:symbol?interval=1h` (salah interval, deprecated untuk chart)
- `useMarkets.ts:38-48` — ambil 12 candle 1-jam
- `useMarkets.ts:100-109` — fallback random `Math.random()` data kalau kline kosong
- `PriceChart.tsx` — custom SVG line chart, gambar close price doang (bukan OHLC)
- Target price line **udah ada** (`PriceChart.tsx:91-102`) ✅

**Fix:**
1. Ganti seed endpoint: `fetchKline` → panggil `GET /api/prices/candles/:symbol`
   - Response: `{ source: "cache" | "rest", interval: "1m", data: [{ t, T, o, c, h, l, v, n }] }`
   - `v` dan `n` selalu `0` (mark price bukan trade-based, jangan tampilin volume)
2. Listen `CANDLE_UPDATE` — replace candle terakhir kalau `openTime` sama, append kalau beda, max 60
3. **Hapus** `fetchKline()` dan `generateFallbackHistory()` — fallback ada di BE
4. **Upgrade** custom SVG line chart → **candlestick** pakai `lightweight-charts` (TradingView). Sekarang data OHLC penuh, sayang kalau cuma render close price.

**CANDLE_UPDATE payload:**
```ts
{
  type: "CANDLE_UPDATE",
  data: {
    symbol: "BTC", interval: "1m",
    openTime: 1776180660000, closeTime: 1776180720000,
    open: 74837, close: 74901, high: 74946, low: 74822,
    volume: 0, trades: 0
  }
}
```

---

## 4. Activity Feed — 100% Fake, Harus Real (P0)

**Current (FE):** `MarketCard.tsx:21, 49-85, 164-177` — generate fake trades pakai:
- `FAKE_NAMES` array random wallet addresses
- `Math.random()` buat amount, side, timestamp
- Setiap 2-6 detik inject fake "trade"

Plus `LiveTrades.tsx` — floating trade labels juga fake.

**Fix:**
- Subscribe `NEW_VOTE` via WS. Payload:
  ```ts
  { type: "NEW_VOTE", data: { marketId, userWallet, side: "yes"|"no", amount } }
  ```
- Filter by `marketId` di card yang lagi aktif, push ke state activity (keep last 4-5)
- Tampilin wallet truncated: `${wallet.slice(0,4)}...${wallet.slice(-4)}`
- **Hapus** `FAKE_NAMES`, random activity generator, `LiveTrades.tsx` fake content (kalau komponennya tetap mau dipake, feed dari `NEW_VOTE` stream global — semua market)

---

## 5. Market Resolution — Belum Dihandle (P0)

**Current (FE):** `MarketCard.tsx:89` cuma disable button kalau `deadline <= now`. Gak ada visual "Resolved" / winner indicator. Kalau user udah vote, gak kasih tau menang/kalah.

**Status BE:** Broadcast `MARKET_RESOLVED` saat cron settle market:
```ts
{ type: "MARKET_RESOLVED", data: { marketId, resolution: "yes" | "no" } }
```

**Fix:**
- Subscribe `MARKET_RESOLVED` → update market di store (`status = "resolved"`, `resolution = "yes"|"no"`)
- Di `MarketCard`: kalau `resolution` ada, tampilin banner "Resolved: YES / NO" dengan warna, overlay di atas card
- Kalau user punya vote di market itu: tampilin "You won: $X" / "You lost" pakai data dari `/api/vote/user/:wallet` atau payload vote history
- Optional: toast notification "Market BTC resolved as YES, you won $X"

---

## 6. New Market Auto-Insert (P1)

**Current (FE):** `SwipeStack.tsx` render static list yang di-load sekali. Kalau ada market baru di BE (tiap 5 menit), user harus refresh.

**Fix:**
- Subscribe `NEW_MARKET` via WS
- Payload: full market object (sama shape dengan `GET /api/markets`)
- Prepend ke array markets di store
- Optional toast "New market available"

---

## 7. Voter Count Fake (P1)

**Current (FE):** `MarketCard.tsx:182`
```ts
<span>{market.totalVoters + Math.floor(Math.random() * 50 + 20)} voters</span>
```

Random padding 20-70 ditambahin tiap render. Gak honest.

**Fix:** Hapus `+ Math.floor(...)`. Gunain `market.totalVoters` langsung. Update via `NEW_VOTE` event (increment) atau refresh market object.

---

## 8. Deposit Modal — On-Chain Balance Validation (P1)

**Current (FE):** `DepositModal.tsx:22-80` — user input amount manual, gak ada display USDP balance di wallet on-chain. Bisa submit deposit amount > balance → SPL transfer fail → UX jelek.

**Fix:**
- Pake `useBalance` hook yang udah ada (`hooks/useBalance.ts` — fetch SOL + SPL dari devnet RPC)
- Display "Available: $X USDP" di modal
- Validate amount ≤ available sebelum submit
- Disable submit button kalau balance insufficient

**Bonus:** Juga di `TradeModal.tsx` — kalau balance internal < amount, kasih shortcut "Deposit now" yang buka `DepositModal`.

---

## 9. Sentiment — Endpoint Unused (P2)

**Status BE:** `GET /api/sentiment/:symbol` return Elfa data (`bullishPercent`, `mentionCount`, `topMentions`). `GET /api/sentiment` (tanpa symbol) return trending tokens.

**Current (FE):** `MarketCard.tsx:94-139` tampilin `market.sentiment` (angka 0-100) sebagai "Elfa AI" bar — tapi data-nya dari initial market fetch, **never refreshed**, dan label "Elfa AI" misleading karena belum ada call ke endpoint sentiment.

**Fix:**
- Buat `useSentiment(symbol)` hook, poll `/api/sentiment/:symbol` setiap 5 menit
- Cache per symbol di Zustand biar gak refetch ulang
- Tampilin `topMentions` (expandable section) buat social proof

---

## 10. Withdraw TX Explorer Link (P2)

**Current (FE):** `WithdrawModal.tsx:22-37` — tampilin TX signature sebagai plain text setelah withdraw sukses. User gak bisa verify langsung.

**Fix:**
- Render sebagai link: `https://solscan.io/tx/${txSignature}?cluster=devnet`
- Atau `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`

---

## 11. Balance Sync Across Pages (P2)

**Current (FE):**
- `profile/page.tsx` fetch balance on mount
- `TradeModal.tsx` fetch balance on open
- Gak sync: kalau user vote di feed, balance di profile page stale sampai refresh manual

**Fix:**
- Pindahin `balance` ke Zustand store (`useStore`)
- Setelah vote/deposit/withdraw sukses, update store langsung
- Atau: expose `refreshBalance()` di context, panggil dari semua tempat yang perlu

---

## 12. Vote History — Stale di Profile (P2)

**Current (FE):** `profile/page.tsx:29-44` — fetch `/api/vote/user/:wallet` sekali on mount. Kalau user vote baru atau market resolved, list gak auto-update.

**Fix:**
- Auto-refresh on `MARKET_RESOLVED` event (trigger `loadData()`)
- Auto-refresh on `NEW_VOTE` kalau `userWallet === currentWallet`
- Atau simple: poll tiap 30s selagi profile page aktif

---

## 13. Transaction History Unused (P2)

**Status BE:** `GET /api/wallet/transactions/:address` tersedia tapi **never called** dari FE.

**Fix:**
- Tambah tab "Transactions" di profile page
- List deposits + withdrawals dengan timestamp, amount, status, TX signature
- Integrasi dengan explorer link (section 10)

---

## 14. Hardcoded Values → Env Vars (P2)

| Value | Current Location | Move to |
|-------|------------------|---------|
| `RPC_URL = "https://api.devnet.solana.com"` | `hooks/useBalance.ts:5` | `NEXT_PUBLIC_SOLANA_RPC` |
| `USDP_MINT = "USDPqRbLidFGufty2s3oizmDEKdqx7ePTqzDMbf5ZKM"` | `DepositModal.tsx:11` | `NEXT_PUBLIC_USDP_MINT` ✅ (env var ada di `.env.example`, tinggal pake) |
| `BACKEND_WALLET = "8SnuZxuTXWRfmHPypqCAq7tFeqboSkyAtrd9ng34VPBy"` | `DepositModal.tsx:12` | `NEXT_PUBLIC_BACKEND_WALLET` ✅ (sama) |

---

## 15. Leaderboard Freshness & Pagination (P2-P3)

**Current (FE):** `leaderboard/page.tsx:19-24` — fetch sekali on mount, `limit=20`, no pagination.

**Fix:**
- Polling 30-60s (leaderboard gak se-realtime market, polling cukup)
- "Load More" button (BE support `?limit=100` max)

---

## 16. Unused Components / Features

### CategoryPill unused (P3)
`components/CategoryPill.tsx` — komponen ada tapi gak dipake. Integrate ke Explore page buat filter.

### Pacifica client unused (P3)
`lib/pacifica-client.ts` — `createMarketOrder()` dan `fetchPacificaPrices()` ada tapi never called. Bisa dihapus atau disimpan buat fitur future (direct perp order).

### Trending tokens endpoint unused (P3)
`GET /api/sentiment` (tanpa symbol) — return trending Elfa tokens. Bisa dipake buat badge "🔥 Trending" di MarketCard.

---

## 17. Mock Data Fallback (P2 — opsional)

**Current (FE):** `useMarkets.ts:53-57` — kalau BE error/empty, fallback ke `mockMarkets`. Keep behavior ini, tapi:
- Show banner "Using offline data" yang lebih prominent
- Add retry button
- Log error ke console untuk debug

---

## 18. Perubahan BE Non-FE-Breaking (context)

Biar partner FE tau konteksnya:

### Market Generation
- Pool coin naik dari 6 → **24 curated** (BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, SUI, LINK, LTC, TON, AAVE, NEAR, ARB, UNI, HYPE, TAO, JUP, WLD, TRUMP, PUMP, BCH, XMR) + **4 dari Elfa trending** tiap batch
- Tiap batch 5 menit → **10 market baru** (6 curated + 4 trending)
- Pastikan komponen asset/logo handle symbol beragam (icon fallback)

### Market Duration
- Semua market sekarang **fixed 5 menit**
- Kalau ada hardcoded copy "1 min" / "15 min" → simplify ke 5 min

### Database
- Migrate dari SQLite ke **Postgres (Supabase)**
- `mapMarket()` di `api.ts:5-22` sudah handle dual naming (camelCase/snake_case) ✅
- Verify endpoint lain (`fetchUserVotes`, `fetchLeaderboard`, `fetchBalance`) — kalau ada field camelCase yang sekarang snake_case, update mapper

### Auth (tunggu BE ready)
- Beberapa endpoint (vote, wallet ops) belum ada signature verification
- BE punya `auth.ts` + `middleware.ts` tapi belum wired
- Nanti FE perlu sign message via Solana wallet, kirim header `X-Wallet-Signature`, `X-Wallet-Public-Key`, `X-Wallet-Message`
- Koordinasi dulu soal format message sebelum implement

---

## 19. Endpoint Usage Matrix

| Endpoint | FE Usage | Status | Action |
|----------|----------|--------|--------|
| GET /api/markets | ✅ useMarkets | OK | Subscribe `NEW_MARKET` untuk live |
| GET /api/markets/:id | ❌ Never | Unused | Bisa buat market detail page |
| GET /api/prices | ✅ polling 1s | ⚠️ | Replace dgn `PRICE_UPDATE` WS |
| GET /api/prices/kline/:symbol?interval=1h | ✅ chart seed | ⚠️ | Ganti ke `/candles/:symbol` |
| GET /api/prices/candles/:symbol | ❌ Never | New | **Use for chart seed** |
| GET /api/prices/book/:symbol | ❌ Never | Unused | - |
| GET /api/prices/info | ❌ Never | Unused | - |
| POST /api/vote | ✅ TradeModal | OK | - |
| GET /api/vote/user/:wallet | ✅ profile | OK | Auto-refresh on events |
| GET /api/leaderboard | ✅ leaderboard | OK | Add polling |
| GET /api/wallet/balance/:address | ✅ profile + TradeModal | OK | Sync via Zustand |
| POST /api/wallet/deposit | ✅ DepositModal | OK | Add balance validation |
| POST /api/wallet/withdraw | ✅ WithdrawModal | OK | Add explorer link |
| GET /api/wallet/transactions/:address | ❌ Never | Unused | Buat transactions tab di profile |
| GET /api/sentiment/:symbol | ❌ Never | Unused | Poll untuk live Elfa |
| GET /api/sentiment | ❌ Never | Unused | Trending badge |
| WS `PRICE_UPDATE` | ❌ Never | - | **P1** |
| WS `CANDLE_UPDATE` | ❌ Never | - | **P0** |
| WS `NEW_MARKET` | ❌ Never | - | **P1** |
| WS `MARKET_RESOLVED` | ❌ Never | - | **P0** |
| WS `NEW_VOTE` | ❌ Never | - | **P0** |

---

## 20. File Reference

**Pages:**
- `fe/src/app/page.tsx` — Feed (main swipe UI)
- `fe/src/app/explore/page.tsx` — Explore with filter
- `fe/src/app/leaderboard/page.tsx`
- `fe/src/app/profile/page.tsx`

**Components:**
- `fe/src/components/MarketCard.tsx` — **big cleanup**: fake activity, voter padding
- `fe/src/components/TradeModal.tsx` — voting OK, balance sync needed
- `fe/src/components/PriceChart.tsx` — custom SVG, **upgrade ke candlestick**
- `fe/src/components/DepositModal.tsx` — add balance validation
- `fe/src/components/WithdrawModal.tsx` — add explorer link
- `fe/src/components/SwipeStack.tsx` — subscribe `NEW_MARKET`
- `fe/src/components/LiveTrades.tsx` — **fake content, wire ke `NEW_VOTE`**
- `fe/src/components/CategoryPill.tsx` — unused, integrate ke Explore

**Hooks:**
- `fe/src/hooks/useMarkets.ts` — **big refactor**: WS + candle endpoint
- `fe/src/hooks/useBalance.ts` — on-chain balance (reuse di DepositModal)
- `fe/src/hooks/useWebSocket.ts` — **create new** (P0)

**Lib:**
- `fe/src/lib/api.ts` — add `fetchCandles()`, remove `fetchKline()`
- `fe/src/lib/ws-client.ts` — **create new** (P0)
- `fe/src/lib/pacifica-client.ts` — unused, bisa dihapus
- `fe/src/store/useStore.ts` — expand (balance, votes, ws status)
