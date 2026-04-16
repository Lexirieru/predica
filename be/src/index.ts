import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import http from "http";
import rateLimit from "express-rate-limit";
import marketsRouter from "./routes/markets";
import votesRouter from "./routes/votes";
import pricesRouter from "./routes/prices";
import leaderboardRouter from "./routes/leaderboard";
import sentimentRouter from "./routes/sentiment";
import walletRouter from "./routes/wallet";
import portfolioRouter from "./routes/portfolio";
import achievementsRouter from "./routes/achievements";
import adminRouter from "./routes/admin";
import notificationsRouter from "./routes/notifications";
import {
  startSettlementCron,
  startPriceStream,
  startMarketGeneratorCron,
  startMarketActivatorCron,
  startCandleCleanupCron,
  warmCandleCache,
  warmElfaValidityCache,
} from "./lib/crons";
import { initWebSocketServer } from "./lib/websocket";
import "./db/migrate"; // Run auto-migration

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || "3001");

// Security headers via helmet — nosniff, X-Frame-Options: DENY, X-DNS-Prefetch,
// Referrer-Policy, etc. CSP is disabled because this process only serves JSON;
// there is no HTML surface to protect, and CSP headers on JSON responses add
// noise without benefit.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// CORS — strict allowlist from env. Comma-separated list; server-to-server
// calls with no Origin header are also allowed. credentials:false because
// the API authenticates via signed X-Signature headers, never cookies — so
// there is nothing for a browser to automatically attach, and turning off
// credentials removes any ambiguity for the browser CORS checker.
export const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: false,
  }),
);

// Body size cap — our largest payload is a vote/deposit (<1KB). 10KB is generous.
app.use(express.json({ limit: "10kb" }));

// Reject write requests that aren't application/json. Browsers let HTML forms
// POST application/x-www-form-urlencoded or multipart/form-data cross-origin
// without a preflight (simple-request), which is the classic CSRF surface.
// Requiring application/json forces a preflight, which our strict CORS then
// blocks for foreign origins. Combined with the signature auth on write
// endpoints, this closes the CSRF gap even without a dedicated CSRF token.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
    const ct = req.headers["content-type"] || "";
    if (!ct.toLowerCase().includes("application/json")) {
      res.status(415).json({ error: "Content-Type must be application/json" });
      return;
    }
  }
  next();
});

// Global rate limit: 120 req/min/IP. Trust the proxy count only when deployed
// behind one (set TRUST_PROXY=1). Hackathon-safe default without trust.
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down" },
});

// Tighter limit on write/financial endpoints.
const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many write requests, please slow down" },
});

app.use("/api/", globalLimiter);
app.use("/api/vote", writeLimiter);
app.use("/api/wallet", writeLimiter);

// Initialize WebSocket
initWebSocketServer(server);

// Routes
app.use("/api/markets", marketsRouter);
app.use("/api/vote", votesRouter);
app.use("/api/prices", pricesRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/sentiment", sentimentRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/achievements", achievementsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/notifications", notificationsRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Start cron jobs
startSettlementCron();
startPriceStream();
startMarketActivatorCron();
startCandleCleanupCron();

// Elfa validity and candle-cache warmers are independent — run in parallel so
// cold-start latency is the max of the two, not the sum. Market generator
// still waits on Elfa validity so the first bucket batch only picks symbols
// that passed validation.
Promise.all([warmElfaValidityCache(), warmCandleCache()]).then(() =>
  startMarketGeneratorCron(),
);

server.listen(PORT, () => {
  console.log(`Predica backend running on http://localhost:${PORT}`);
});
