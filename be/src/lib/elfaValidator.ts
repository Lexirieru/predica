/**
 * Tracks which symbols Elfa actually has ticker-level mention data for.
 *
 * Elfa's trending aggregator is broader than its per-ticker dataset — stocks
 * like NVDA / TSLA / GOOGL appear in trending counts but `top-mentions?ticker=X`
 * returns 0 rows for them. We don't want markets on symbols with no Elfa data
 * because the sentiment bar and activity feed would be permanently empty.
 *
 * This module caches validity per symbol (1h TTL) and exposes a parallel
 * warmer for startup so the first bucket generation isn't blocked on N
 * sequential API calls.
 */

import * as elfa from "./elfa";

const CACHE_TTL_MS = 60 * 60 * 1000;
const WARM_CHUNK = 8; // concurrent probes; keep under Elfa rate limits

interface Entry {
  valid: boolean;
  checkedAt: number;
}

const cache = new Map<string, Entry>();

async function probe(symbol: string): Promise<boolean> {
  try {
    const r = await elfa.getTopMentions(symbol);
    return (r?.metadata?.total ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function isElfaTracked(symbol: string): Promise<boolean> {
  const sym = symbol.toUpperCase();
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.checkedAt < CACHE_TTL_MS) return hit.valid;

  const valid = await probe(sym);
  cache.set(sym, { valid, checkedAt: Date.now() });
  return valid;
}

/**
 * Warm the cache for the given symbols in bounded-concurrency chunks.
 * Called at startup so `ensureUpcomingBuckets` doesn't take forever on the
 * first run. Safe to invoke repeatedly — skips entries that are already fresh.
 */
export async function warmElfaValidity(symbols: string[]): Promise<void> {
  const toProbe = symbols
    .map((s) => s.toUpperCase())
    .filter((s) => {
      const hit = cache.get(s);
      return !hit || Date.now() - hit.checkedAt >= CACHE_TTL_MS;
    });

  for (let i = 0; i < toProbe.length; i += WARM_CHUNK) {
    const chunk = toProbe.slice(i, i + WARM_CHUNK);
    await Promise.all(
      chunk.map(async (s) => {
        const valid = await probe(s);
        cache.set(s, { valid, checkedAt: Date.now() });
      }),
    );
  }

  const valid = Array.from(cache.entries())
    .filter(([, v]) => v.valid)
    .map(([k]) => k);
  console.log(`[ElfaValidity] Warmed ${toProbe.length} symbols. Tracked: ${valid.length} (${valid.join(", ")})`);
}

/** Snapshot of symbols currently known to be Elfa-tracked. For debug/stats. */
export function getTrackedSet(): Set<string> {
  const set = new Set<string>();
  for (const [sym, { valid }] of cache.entries()) {
    if (valid) set.add(sym);
  }
  return set;
}
