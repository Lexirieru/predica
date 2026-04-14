import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import rateLimit from "express-rate-limit";
import marketsRouter from "./routes/markets";
import votesRouter from "./routes/votes";
import pricesRouter from "./routes/prices";
import leaderboardRouter from "./routes/leaderboard";
import sentimentRouter from "./routes/sentiment";
import walletRouter from "./routes/wallet";
import { startSettlementCron, startPriceStream, startMarketGeneratorCron } from "./lib/crons";
import { initWebSocketServer } from "./lib/websocket";
import "./db/migrate"; // Run auto-migration

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || "3001");

// CORS — restrict to known frontend origins. Comma-separated list in env.
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow server-to-server / same-origin requests with no Origin header.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }),
);

// Body size cap — our largest payload is a vote/deposit (<1KB). 10KB is generous.
app.use(express.json({ limit: "10kb" }));

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

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Start cron jobs
startSettlementCron();
startPriceStream();
startMarketGeneratorCron();

server.listen(PORT, () => {
  console.log(`Predica backend running on http://localhost:${PORT}`);
});
