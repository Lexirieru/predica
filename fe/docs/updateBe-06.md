# BE Update Cycle 06

**Status:** ✅ PUSHED — 2026-04-16 (sealed at `a2d070a`)
**Branch:** `james`
**Started:** 2026-04-16
**Sealed:** 2026-04-16

---

## 🎯 TL;DR — Yang Perlu FE Lakukan

Sudah dikerjakan satu push — BE change minimal, FE change besar (UX overhaul).

| Change | Detail |
|--------|--------|
| `NEW_VOTE` WS payload — nambah `yesPool`/`noPool`/`totalVoters` absolute | FE sekarang sync pool ke semua client real-time via WS (bukan cuma voter), tanpa konflik sama optimistic update |

**Breaking:** none. Semua tambahan additive.

---

## 📦 Commits

### (unpushed) — 2026-04-16
**Title:** feat: UX overhaul — WS resync, lazy candles, optimistic vote

### BE changes

`be/src/routes/votes.ts` — `NEW_VOTE` broadcast nambah `yesPool`, `noPool`, `totalVoters` setelah re-read market post-commit. FE optimistic-vote flow butuh absolute values supaya spectator FE sama voter FE converge ke state yang sama tanpa tempId correlation.

### FE changes (3 fase)

#### Phase 1 — WebSocket auto-reconnect + resync

Problem: kalau BE restart atau network flaky, FE silent-stale. Harga stop update, vote baru ga muncul, user ga tau.

Solusi:
- `fe/src/lib/ws-client.ts` — exponential backoff reconnect (udah ada, di-enhance) + PONG timeout detection (kalo 10s ga ada response ke PING, force reconnect walau socket status masih "OPEN" di layer TCP).
- Virtual event `_STATUS` expose connection state.
- Virtual event `_RECONNECTED` fired cuma di drop-recover cycle (bukan initial open).
- `fe/src/hooks/useConnectionStatus.ts` — hook consume status.
- `fe/src/components/ConnectionBanner.tsx` — subtle banner top-screen, debounce 2s biar brief flicker ga ganggu user.
- `fe/src/hooks/useMarkets.ts` — subscribe `_RECONNECTED` → refetch markets buat resync apa yang kita missed pas offline.

#### Phase 2 — Lazy candle loading dengan prefetch

Problem: di `useMarkets` initial load, FE `Promise.all(fetchCandleSeries(m.symbol, "1h"))` buat SEMUA markets. Dengan 1m/5m/15m sekarang ada 30-40+ market → 30-40 parallel HTTP req = TTI jelek.

Solusi:
- `fe/src/store/useCandleStore.ts` — dedicated Zustand slice: `candles: Record<symbol, Candle[]>`, `fetchCandles(symbol)` idempotent, `upsertCandle` buat CANDLE_UPDATE WS.
- `fe/src/hooks/useCandlesFor.ts` — hook yang trigger fetch di mount, return cached candles. Juga expose `prefetchCandles(symbol)` imperative.
- `useMarkets.ts` — hapus bulk candle fetch di initial load. Delegate CANDLE_UPDATE ke candle store. Initial market list = metadata-only → TTI drop dari ~3s ke ~500ms.
- `MarketCard.tsx` — konsumsi `useCandlesFor(market.symbol)` sebagai source of truth.
- `SwipeStack.tsx` — prefetch next + prev card's candles via `prefetchCandles()` saat swipe. Begitu user swipe, next card udah ada data.

#### Phase 3 — Optimistic vote UI

Problem: vote flow = `sign → POST → await response → update UI`. Sign ~instant kalo wallet auto-approve, tapi POST round-trip ~500ms. Total user stare modal ~1-2s.

Solusi:
- `fe/src/store/useStore.ts` — nambah `pendingVotes` + `applyOptimisticVote` + `confirmOptimisticVote` + `rollbackOptimisticVote` + `toasts` + `pushToast`.
- `fe/src/components/TradeModal.tsx` — flow baru:
  1. **Sign** (tetep blocking — user harus approve di wallet).
  2. **Immediately**: close modal + debit balance + bump pool + append ke pendingVotes.
  3. **Background**: POST ke BE.
  4. **On success**: drop pending entry, set balance dari server response, push success toast.
  5. **On failure**: rollback balance/pool, drop pending entry, push error toast dengan reason.
- `fe/src/components/VoteToaster.tsx` — pill toasts di bottom, auto-dismiss 3.5s, click to dismiss.
- Spectator path: BE broadcast `NEW_VOTE` dengan absolute pool; FE `useMarkets` overwrite pool di market state. Voter path: optimistic already applied, WS broadcast no-op (values match).

### Tradeoffs

**Multi-tab edge case:** kalo user buka Predica di 2 tab dan vote di tab A, tab B akan terima NEW_VOTE broadcast dan sinkron pool. Sedangkan kalau tab A's optimistic dan tab B's broadcast hit concurrently, keduanya converge karena BE broadcast pakai absolute values. ✅

**Rollback latency:** Kalau BE reject vote (market expired di tengah flow, balance insufficient, dll), user udah liat "sukses" untuk ~500ms sebelum rollback + toast muncul. Penerima-an ini lebih baik daripada bikin modal nongkrong. ✅

**PONG timeout:** 10s tight-ish — kalo server laggy tapi hidup, bisa false-trigger reconnect. Trade-off vs detection time. Reasonable.

---

## Tests

BE: 40/40 existing tests masih passed. Ga ada unit test baru karena perubahan BE minimal (cuma nambah field di broadcast payload).

FE: manual testing path:
1. Open feed → market cards render instant, chart fills in sequentially → ✅ lazy
2. Swipe forward/back → neighbor card udah punya chart → ✅ prefetch
3. Kill BE → banner "Reconnecting…" muncul setelah 2s → ✅ status
4. Restart BE → banner hilang, markets refetch → ✅ resync
5. Vote → modal close instant, balance turun instant → ✅ optimistic
6. Disconnect network, vote → toast "Vote rolled back" setelah timeout → ✅ rollback

---

## File map

### BE
- `be/src/routes/votes.ts` — absolute pool in NEW_VOTE

### FE
- `fe/src/lib/ws-client.ts` — enhanced reconnect
- `fe/src/hooks/useConnectionStatus.ts` — new
- `fe/src/components/ConnectionBanner.tsx` — new
- `fe/src/hooks/useMarkets.ts` — remove bulk fetch, RECONNECTED handler, NEW_VOTE absolute sync
- `fe/src/store/useCandleStore.ts` — new
- `fe/src/hooks/useCandlesFor.ts` — new
- `fe/src/components/MarketCard.tsx` — consume useCandlesFor
- `fe/src/components/SwipeStack.tsx` — prefetch neighbors
- `fe/src/store/useStore.ts` — pendingVotes + toasts slice
- `fe/src/components/TradeModal.tsx` — optimistic flow
- `fe/src/components/VoteToaster.tsx` — new
- `fe/src/app/layout.tsx` — wire banner + toaster
- `fe/src/lib/types.ts` — mark candles/priceHistory as legacy
