import type { CandleTick } from "./pacificaWs";

const MAX_CANDLES_PER_SYMBOL = 60;

// symbol → rolling buffer of candles, oldest first
const cache = new Map<string, CandleTick[]>();

/**
 * Push a candle tick. If the last cached candle has the same openTime,
 * replace it (candle still forming). Otherwise append and trim.
 */
export function pushCandle(tick: CandleTick) {
  const sym = tick.symbol.toUpperCase();
  const buf = cache.get(sym) ?? [];

  const last = buf[buf.length - 1];
  if (last && last.openTime === tick.openTime) {
    buf[buf.length - 1] = tick;
  } else {
    buf.push(tick);
    if (buf.length > MAX_CANDLES_PER_SYMBOL) buf.shift();
  }

  cache.set(sym, buf);
}

export function getCandles(symbol: string): CandleTick[] {
  return cache.get(symbol.toUpperCase()) ?? [];
}

export function clearCandles(symbol: string) {
  cache.delete(symbol.toUpperCase());
}
