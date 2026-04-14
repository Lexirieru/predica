import { Router, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { markets, achievements, users, votes, candleSnapshots } from "../db/schema";
import { getTrackedSet } from "../lib/elfaValidator";
import { getConnectedClientCount } from "../lib/websocket";

const router = Router();

// Bearer-token guard. Gate the whole admin surface behind ADMIN_TOKEN from env
// so the health endpoint can be exposed without leaking operational details.
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    res.status(503).json({ error: "Admin endpoints disabled (ADMIN_TOKEN not set)" });
    return;
  }
  const header = req.headers.authorization || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token as string | undefined);
  if (supplied !== token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// GET /api/admin/health
// Operational snapshot of the backend. Not exposed to FE — intended for
// dashboards / curl checks by operators.
router.get("/health", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [
      activeMarketRows,
      upcomingMarketRows,
      settledTodayRows,
      totalVotesRows,
      totalUsersRows,
      totalAchievementsRows,
      candleRowsRows,
      distinctCandleSymbolsRows,
    ] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS n FROM ${markets} WHERE status = 'active'`),
      db.execute(sql`SELECT COUNT(*)::int AS n FROM ${markets} WHERE status = 'upcoming'`),
      db.execute(sql`SELECT COUNT(*)::int AS n FROM ${markets} WHERE status = 'settled' AND updated_at > ${Date.now() - 24*60*60*1000}`),
      db.execute(sql`SELECT COUNT(*)::int AS n FROM ${votes}`),
      db.execute(sql`SELECT COUNT(*)::int AS n FROM ${users}`),
      db.execute(sql`SELECT COUNT(*)::int AS n FROM ${achievements}`),
      db.execute(sql`SELECT COUNT(*)::int AS n FROM ${candleSnapshots}`),
      db.execute(sql`SELECT COUNT(DISTINCT symbol)::int AS n FROM ${candleSnapshots}`),
    ]);

    const num = (r: unknown) => {
      const rows = (r as { rows?: Array<{ n: number }> }).rows ?? [];
      return Number(rows[0]?.n ?? 0);
    };

    res.json({
      ok: true,
      timestamp: Date.now(),
      uptime_ms: Math.floor(process.uptime() * 1000),
      markets: {
        active: num(activeMarketRows),
        upcoming: num(upcomingMarketRows),
        settled_last_24h: num(settledTodayRows),
      },
      users: {
        total: num(totalUsersRows),
        total_votes: num(totalVotesRows),
      },
      achievements: {
        total_unlocked: num(totalAchievementsRows),
      },
      candles: {
        rows: num(candleRowsRows),
        symbols_tracked: num(distinctCandleSymbolsRows),
      },
      elfa: {
        tracked_symbols: Array.from(getTrackedSet()).sort(),
      },
      websocket: {
        connected_clients: getConnectedClientCount(),
      },
      runtime: {
        node: process.version,
        pid: process.pid,
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });
  } catch (err) {
    console.error("[Admin/health] Error:", err);
    res.status(500).json({ ok: false, error: "Health check failed" });
  }
});

export default router;
