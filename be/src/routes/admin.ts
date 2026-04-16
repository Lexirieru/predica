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
    // Single aggregation query keeps us to one pool connection — admin health
    // gets hit during incidents when the pool is already stressed, so batching
    // 8 COUNTs into one round-trip beats 8 parallel connections.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const aggRows = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM ${markets} WHERE status = 'active')                    AS active_markets,
        (SELECT COUNT(*)::int FROM ${markets} WHERE status = 'upcoming')                  AS upcoming_markets,
        (SELECT COUNT(*)::int FROM ${markets} WHERE status = 'settled' AND updated_at > ${dayAgo}) AS settled_last_24h,
        (SELECT COUNT(*)::int FROM ${votes})                                              AS total_votes,
        (SELECT COUNT(*)::int FROM ${users})                                              AS total_users,
        (SELECT COUNT(*)::int FROM ${achievements})                                       AS total_achievements,
        (SELECT COUNT(*)::int FROM ${candleSnapshots})                                    AS candle_rows,
        (SELECT COUNT(DISTINCT symbol)::int FROM ${candleSnapshots})                      AS candle_symbols
    `);

    const row = (aggRows as { rows?: Array<Record<string, number>> }).rows?.[0] ?? {};
    const num = (key: string) => Number(row[key] ?? 0);

    res.json({
      ok: true,
      timestamp: Date.now(),
      uptime_ms: Math.floor(process.uptime() * 1000),
      markets: {
        active: num("active_markets"),
        upcoming: num("upcoming_markets"),
        settled_last_24h: num("settled_last_24h"),
      },
      users: {
        total: num("total_users"),
        total_votes: num("total_votes"),
      },
      achievements: {
        total_unlocked: num("total_achievements"),
      },
      candles: {
        rows: num("candle_rows"),
        symbols_tracked: num("candle_symbols"),
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
