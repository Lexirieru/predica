import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
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

app.use(cors());
app.use(express.json());

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
