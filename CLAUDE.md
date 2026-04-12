# Predica — Crypto Prediction Market on Pacifica

## What is this?
Platform prediction market dimana user tebak harga crypto naik atau turun dalam 5 menit. Mirip Polymarket tapi fokus crypto prices, pakai data real-time dari Pacifica (perpetual exchange di Solana). TikTok-style swipe feed.

**Hackathon:** Pacifica 2026 Hackathon Track 3 (Social & Gamification). Deadline: April 16, 2026.

## How to Run

### 1. Backend (port 3001)
```bash
cd be/
npm install
cp .env.example .env   # fill in API keys (see be/README.md)
npm run dev             # starts with hot reload via tsx
```

### 2. Frontend (port 3000)
```bash
cd fe/
bun install
cp .env.example .env.local   # fill in project IDs
bun run dev
```

### 3. Create Markets
Markets auto-generate on backend startup (5s delay) from Elfa AI trending tokens.
Each market lasts 5 minutes. New batch every 5 minutes after settlement.

To force new markets: restart backend (markets generate on startup).
Do NOT delete `predica.db` unless you want to wipe all history.

## Project Structure
```
predica/
├── fe/                    # Next.js 15 frontend (bun)
│   ├── src/
│   │   ├── app/           # Pages: feed, explore, leaderboard, profile
│   │   ├── components/    # MarketCard, SwipeStack, TradeModal, DepositModal, etc
│   │   ├── hooks/         # useMarkets (data fetching + live prices)
│   │   ├── lib/           # api.ts (backend calls), types, mock-data
│   │   └── store/         # Zustand store
│   └── .env.example
├── be/                    # Express + TypeScript backend
│   ├── src/
│   │   ├── routes/        # markets, votes, prices, wallet, leaderboard, sentiment
│   │   ├── lib/           # pacifica.ts, elfa.ts, solana.ts, crons.ts
│   │   └── db/            # schema.ts, markets.ts, votes.ts
│   ├── README.md          # Full backend documentation
│   └── .env.example
└── fe-swipenit/           # Reference UI code (READ-ONLY, do not modify)
```

## Tech Stack
- **Frontend:** Next.js 15, Tailwind CSS, Framer Motion, Reown AppKit (Solana wallet), Zustand
- **Backend:** Express + TypeScript, SQLite (better-sqlite3), node-cron
- **APIs:** Pacifica REST (real-time prices), Elfa AI (trending tokens + sentiment)
- **Chain:** Solana devnet, USDP token (Pacifica testnet stablecoin)
- **Wallet:** Reown AppKit — supports Solflare, Phantom, etc

## Core Flow
1. User connects Solana wallet via Reown
2. Deposits USDP (on-chain SPL transfer from user wallet → backend vault wallet)
3. Browses TikTok-style feed of "BTC Up or Down - 5 Minutes" markets
4. Votes Up or Down using internal balance (no on-chain tx per vote)
5. After 5 min deadline: settlement checks Pacifica mark price vs target
6. Winners get proportional pool payout, losers get 0
7. User can withdraw USDP winnings (on-chain SPL transfer back)

## Environment Variables

### Backend (be/.env)
- `ELFA_API_KEY` — from Elfa AI (20k bonus credits)
- `SOLANA_PRIVATE_KEY` — base58 private key for vault wallet (needs devnet SOL + USDP)
- `BACKEND_WALLET_ADDRESS` — public key of above
- `USDP_MINT` — `USDPqRbLidFGufty2s3oizmDEKdqx7ePTqzDMbf5ZKM`

### Frontend (fe/.env.local)
- `NEXT_PUBLIC_REOWN_PROJECT_ID` — from dashboard.reown.com
- `NEXT_PUBLIC_BACKEND_WALLET` — same as BACKEND_WALLET_ADDRESS
- `NEXT_PUBLIC_USDP_MINT` — same as above

## What Needs Work
See `be/README.md` for detailed backend TODO list. Key items:
1. **Security** — API endpoints have no auth, need signature verification
2. **Websocket** — replace polling with real-time push
3. **Deposit verification** — needs retry logic
4. **Market variety** — 1min/5min/15min windows
5. **UI polish** — chart improvements, animations

## Important Notes
- Do NOT modify `fe-swipenit/` — read-only reference
- Backend vault wallet needs devnet SOL (for gas) and USDP (from Pacifica faucet)
- Pacifica faucet: https://test-app.pacifica.fi/faucet (access code: "Pacifica")
- Pacifica testnet API: https://test-api.pacifica.fi/api/v1
- Elfa AI docs: https://docs.elfa.ai/getting-started
