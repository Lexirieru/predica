import type { CandleTick } from "./pacificaWs";
import { db } from "../db";
import { candleSnapshots } from "../db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

const INTERVAL = "1m";
const MAX_CANDLES_PER_SYMBOL = 60;
const PERSIST_THROTTLE_MS = 2_000;
export const CANDLE_RETENTION_DAYS = 2;

// symbol → rolling buffer of candles, oldest first. Hot layer.
const cache = new Map<string, CandleTick[]>();
// symbol → last ms we persisted a candle with this openTime
const lastPersist = new Map<string, number>();

function bufKey(symbol: string): string {
  return symbol.toUpperCase();
}

/**
 * Hot-path: update in-memory buffer (replace-or-append) AND upsert to DB
 * throttled per symbol. Live candle upserts every ~2s; a new openTime always
 * triggers immediate persist so settled candles don't get lost.
 */
export function pushCandle(tick: CandleTick) {
  const sym = bufKey(tick.symbol);
  const buf = cache.get(sym) ?? [];

  const last = buf[buf.length - 1];
  const isNewCandle = !last || last.openTime !== tick.openTime;

  if (!isNewCandle) {
    buf[buf.length - 1] = tick;
  } else {
    buf.push(tick);
    if (buf.length > MAX_CANDLES_PER_SYMBOL) buf.shift();
  }
  cache.set(sym, buf);

  // Persist: always on new-candle boundary, throttled for in-progress updates.
  const now = Date.now();
  const lastWrite = lastPersist.get(sym) ?? 0;
  if (isNewCandle || now - lastWrite >= PERSIST_THROTTLE_MS) {
    lastPersist.set(sym, now);
    persistCandle(sym, tick).catch((err) => {
      const e = err as any;
      console.warn(`[CandleCache] persist failed for ${sym}: ${e?.cause?.message ?? e?.code ?? e?.message}`);
    });
  }
}

async function persistCandle(symbol: string, tick: CandleTick): Promise<void> {
  const row = {
    symbol,
    interval: tick.interval || INTERVAL,
    openTime: tick.openTime,
    closeTime: tick.closeTime,
    open: parseFloat(tick.open),
    close: parseFloat(tick.close),
    high: parseFloat(tick.high),
    low: parseFloat(tick.low),
    volume: parseFloat(tick.volume || "0"),
    trades: tick.trades || 0,
    updatedAt: Date.now(),
  };

  // Upsert on (symbol, interval, openTime) — the PK. An in-flight candle
  // updates the same row as it forms; a new openTime inserts a new row.
  await db
    .insert(candleSnapshots)
    .values(row)
    .onConflictDoUpdate({
      target: [candleSnapshots.symbol, candleSnapshots.interval, candleSnapshots.openTime],
      set: {
        closeTime: row.closeTime,
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        volume: row.volume,
        trades: row.trades,
        updatedAt: row.updatedAt,
      },
    });
}

export function getCandles(symbol: string): CandleTick[] {
  return cache.get(bufKey(symbol)) ?? [];
}

/**
 * Fetch candles covering the last `windowMs` from DB (cold layer). Used when
 * the hot cache is empty or doesn't span enough history (e.g. after restart
 * or for a symbol we haven't been subscribed to recently).
 */
export async function loadCandlesFromDb(
  symbol: string,
  windowMs: number,
): Promise<CandleTick[]> {
  const sym = bufKey(symbol);
  const since = Date.now() - windowMs;

  const rows = await db
    .select()
    .from(candleSnapshots)
    .where(
      and(
        eq(candleSnapshots.symbol, sym),
        eq(candleSnapshots.interval, INTERVAL),
        gte(candleSnapshots.openTime, since),
      ),
    )
    .orderBy(candleSnapshots.openTime);

  return rows.map((r) => ({
    symbol: r.symbol,
    interval: r.interval,
    openTime: Number(r.openTime),
    closeTime: Number(r.closeTime),
    open: String(r.open),
    close: String(r.close),
    high: String(r.high),
    low: String(r.low),
    volume: String(r.volume),
    trades: r.trades,
  }));
}

/**
 * Rehydrate the in-memory cache for the given symbols from the last hour of DB
 * rows. Called on startup so the chart doesn't need to wait for WS ticks
 * before showing history.
 */
export async function warmCacheFromDb(symbols: string[]): Promise<void> {
  for (const sym of symbols) {
    try {
      const rows = await loadCandlesFromDb(sym, 60 * 60 * 1000);
      if (rows.length > 0) {
        cache.set(bufKey(sym), rows.slice(-MAX_CANDLES_PER_SYMBOL));
      }
    } catch (err) {
      console.warn(`[CandleCache] warm failed for ${sym}:`, (err as Error).message);
    }
  }
}

/**
 * Delete candle rows older than CANDLE_RETENTION_DAYS. Meant to be called from
 * a daily cleanup cron. Returns rows deleted for logging.
 */
export async function pruneOldCandles(): Promise<number> {
  const cutoff = Date.now() - CANDLE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const result = await db
    .delete(candleSnapshots)
    .where(sql`${candleSnapshots.openTime} < ${cutoff}`)
    .returning({ openTime: candleSnapshots.openTime });
  return result.length;
}

export function clearCandles(symbol: string) {
  cache.delete(bufKey(symbol));
}
