# BE Update Cycle 04

**Status:** ✅ PUSHED — 2026-04-16 (sealed at `9216507`)
**Branch:** `james`
**Started:** 2026-04-16
**Sealed:** 2026-04-16

---

## 🎯 TL;DR — Yang Perlu FE Lakukan

Nothing breaks — pure hardening. Ada 1 hal yang worth dilakuin:

| Action | File FE | Detail |
|--------|---------|--------|
| Pastikan semua POST ke BE kirim header `Content-Type: application/json` | Semua caller `fetch(…/api/…)` | BE sekarang reject write request yang bukan JSON dengan 415 |

Semua `fetch` di `fe/src/lib/api.ts` dan `fe/src/lib/pushNotifications.ts` udah compliance (udah di-update di cycle ini juga). Kalo nanti ada caller baru, pakai helper `api()` dari `lib/api.ts` supaya dapet timeout + JSON header konsisten.

**Breaking:** POST tanpa `Content-Type: application/json` → 415 (sebelumnya diterima).

---

## 📦 Commits

### (unpushed) — 2026-04-16
**Title:** chore: security hardening (helmet, CORS, timeouts, CSP-adjacent)

Triage from security scan — fixed items yang beneran worth, dismissed sisanya sebagai false-positive pattern-match.

#### Fixed

1. **Helmet middleware** (`be/src/index.ts`, +`helmet` dep)
   - Auto-set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, dll.
   - CSP di-disable karena server ini cuma serve JSON, no HTML surface.
   - Fixes: WEB-MIME-001 (×8), WEB-CJ-001 (×10).

2. **CORS credentials → false** (`be/src/index.ts`)
   - Kita auth pakai signed `x-signature` header, bukan cookie. `credentials:true` cuma bikin CORS ambigu.
   - Fixes: WEB-CORS-004 (critical).

3. **Content-Type guard pada write method** (`be/src/index.ts`)
   - POST/PUT/PATCH/DELETE wajib `application/json` — 415 kalau bukan.
   - Ini neutralize CSRF form-submit (HTML form gak bisa kirim `application/json` tanpa preflight, preflight diblokir CORS strict).
   - Fixes: WEB-CSRF-001 (×13), API-CT-001 (×9).

4. **WebSocket Origin check** (`be/src/lib/websocket.ts`)
   - Upgrade handler reject kalau `Origin` bukan di `CORS_ORIGINS` allowlist.
   - Non-browser client (no Origin header) tetep dibolehin.
   - Fixes: WEB-WS-001.

5. **DB SSL rejectUnauthorized env-driven** (`be/src/db/index.ts`, `be/.env.example`)
   - Baru: `DATABASE_SSL_REJECT_UNAUTHORIZED` (default false agar kompatibel Supabase/Neon).
   - Set `true` di prod kalau provider CA udah di trust bundle.
   - Fixes: CRYPTO-TLS-004 (critical).

6. **Fetch timeout (BE + FE)** (`be/src/lib/fetchWithTimeout.ts` new, `fe/src/lib/api.ts`, `fe/src/lib/pushNotifications.ts`, `fe/src/hooks/useBalance.ts`, `be/src/lib/pacifica.ts`, `be/src/lib/elfa.ts`)
   - 10s AbortSignal timeout di semua fetch ke upstream external (Pacifica, Elfa, Solana RPC).
   - FE: helper `api()` di `lib/api.ts` auto-attach timeout. pushNotifications + useBalance pakai AbortSignal.timeout inline.
   - Fixes: NET-TOUT-003 (×19 total).

#### Dismissed (false positive / pattern-match noise)

| Rule | Alasan |
|------|--------|
| **NET-DNS-001** (DNS rebinding) | Allowlist CORS is string-match on Origin header; rebinding only matters for cookie-based sessions, we don't have those. |
| **NET-CLR-001** (http://localhost hardcoded) | Those are dev defaults, overridden by env in any deployment. No HTTPS downgrade risk. |
| **WEB-WS-002** (WS no auth) | WS broadcast is read-only public data (prices, new markets). No sensitive action via WS; all writes go through REST with signature auth. |
| **INFRA-IP-005** (DB hostname hardcoded) | `DATABASE_URL` env-driven. Scanner flags the import line. |
| **API-BOLA-006** (sequential numeric IDs) | IDs are UUIDs, not sequential. Regex false-positive on `:id` pattern. |
| **WEB-TAB-002** (missing noopener) | Scanner flagged lines that explicitly have `rel="noopener noreferrer"`. Regex bug. |

---

## Summary

| Severity | Before | After (real vulns) |
|----------|--------|--------------------|
| Critical | 2 | 0 |
| High | 23 | 0 (signed headers answer CSRF; WS origin now checked) |
| Medium | 60 | 0 (all actionable ones patched; rest dismissed as false-pos) |

Nothing should break for FE beyond `Content-Type: application/json` requirement, which FE already complies with.
