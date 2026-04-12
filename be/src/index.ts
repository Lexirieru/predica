import "dotenv/config";
import express from "express";
import cors from "cors";
import marketsRouter from "./routes/markets";
import votesRouter from "./routes/votes";
import pricesRouter from "./routes/prices";
import leaderboardRouter from "./routes/leaderboard";
import { seedMarkets } from "./db/markets";
import sentimentRouter from "./routes/sentiment";
import walletRouter from "./routes/wallet";
import { startSettlementCron, startPriceUpdateCron, startMarketGeneratorCron } from "./lib/crons";

const app = express();
const PORT = parseInt(process.env.PORT || "3001");

app.use(cors());
app.use(express.json());

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

// Seed initial markets
seedMarkets();

// Start cron jobs
startSettlementCron();
startPriceUpdateCron();
startMarketGeneratorCron();

app.listen(PORT, () => {
  console.log(`Predica backend running on http://localhost:${PORT}`);
});
