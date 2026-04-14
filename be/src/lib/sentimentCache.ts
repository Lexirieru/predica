/**
 * In-memory sentiment cache with stale-while-revalidate semantics.
 *
 * Flow:
 *   - First request for symbol: compute fast engagement-proxy, kick off LLM refresh.
 *   - Subsequent requests within TTL: return cached (LLM if available, else proxy).
 *   - After TTL expires: serve stale cache, kick off refresh again.
 *
 * Keeps at most one in-flight LLM call per symbol to avoid credit burn storms.
 */

import * as elfa from "./elfa";

const TTL_MS = 5 * 60 * 1000; // 5 min — aligned with market duration
const LLM_ENABLED = process.env.SENTIMENT_LLM_ENABLED !== "false";

export type SentimentSource = "llm" | "engagement" | "neutral";
export type SentimentConfidence = "high" | "medium" | "low";

export interface SentimentResult {
  symbol: string;
  bullishPercent: number;
  mentionCount: number;
  source: SentimentSource;
  confidence: SentimentConfidence;
  summary?: string;
  topMentions?: Array<{ link: string; likes: number; reposts: number; views: number }>;
  lastUpdated: number;
  refreshing: boolean;
}

interface CacheEntry {
  result: SentimentResult;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<void>>();

/**
 * Engagement-based fallback — weighted saturation score. Not true sentiment,
 * but useful as an instant response while LLM refreshes in the background.
 */
async function computeEngagementProxy(symbol: string): Promise<SentimentResult> {
  const ENGAGEMENT_SATURATION = 10;
  try {
    const mentions = await elfa.getTopMentions(symbol);
    const data: Array<Record<string, number>> = mentions?.data || [];
    const sample = data.slice(0, 20);

    let weightedScore = 0;
    for (const m of sample) {
      const engagement = (m.likeCount || 0) + (m.repostCount || 0) * 2;
      weightedScore += Math.min(1, engagement / ENGAGEMENT_SATURATION);
    }

    const bullishPercent = sample.length > 0
      ? Math.round((weightedScore / sample.length) * 100)
      : 50;

    return {
      symbol,
      bullishPercent,
      mentionCount: data.length,
      source: sample.length > 0 ? "engagement" : "neutral",
      confidence: "low",
      topMentions: data.slice(0, 5).map((m) => ({
        link: m.link as unknown as string,
        likes: m.likeCount || 0,
        reposts: m.repostCount || 0,
        views: m.viewCount || 0,
      })),
      lastUpdated: Date.now(),
      refreshing: false,
    };
  } catch {
    return {
      symbol,
      bullishPercent: 50,
      mentionCount: 0,
      source: "neutral",
      confidence: "low",
      lastUpdated: Date.now(),
      refreshing: false,
    };
  }
}

/**
 * Parse Elfa chat tokenAnalysis output for a quantified sentiment signal.
 * Elfa's LLM consistently surfaces phrasing like "86.6% positive votes" or
 * "bullish, with 72% positive"; we extract the first percentage that sits
 * next to a positive cue.
 */
function parseLlmSentiment(text: string): { bullishPercent: number; confidence: SentimentConfidence } | null {
  if (!text) return null;

  // Tier 1 — explicit percentage phrase ("86.6% positive votes", "72% bullish").
  const strongRegex = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:positive|bullish)/i;
  const strong = text.match(strongRegex);
  if (strong) {
    const pct = Math.round(parseFloat(strong[1]));
    if (pct >= 0 && pct <= 100) return { bullishPercent: pct, confidence: "high" };
  }

  const lowered = text.toLowerCase();

  // Tier 2 — strong single-sided qualifiers.
  if (/overwhelmingly bullish|decisively bullish|strongly bullish/.test(lowered)) {
    return { bullishPercent: 85, confidence: "medium" };
  }
  if (/overwhelmingly bearish|decisively bearish|strongly bearish/.test(lowered)) {
    return { bullishPercent: 15, confidence: "medium" };
  }

  // Tier 3 — mixed text (both words appear). Use word-frequency ratio as a
  // rough tilt signal, nudged by explicit "leaning X" phrases.
  const bullishCount = (lowered.match(/\bbullish\b|positive|optimistic|upside/g) || []).length;
  const bearishCount = (lowered.match(/\bbearish\b|negative|pessimistic|downside/g) || []).length;

  if (bullishCount + bearishCount >= 2) {
    const ratio = bullishCount / (bullishCount + bearishCount);
    let pct = Math.round(ratio * 100);
    // Nudge on explicit modifiers
    if (/leaning bullish|tilting (?:positive|bullish)|cautiously bullish/.test(lowered)) pct += 5;
    if (/leaning bearish|tilting (?:negative|bearish)|cautiously bearish/.test(lowered)) pct -= 5;
    return { bullishPercent: Math.max(0, Math.min(100, pct)), confidence: "medium" };
  }

  // Tier 4 — only one side mentioned weakly.
  if (bullishCount > 0 && bearishCount === 0) return { bullishPercent: 70, confidence: "medium" };
  if (bearishCount > 0 && bullishCount === 0) return { bullishPercent: 30, confidence: "medium" };

  if (/mixed|neutral|uncertain/.test(lowered)) {
    return { bullishPercent: 50, confidence: "low" };
  }

  return null;
}

function extractSummary(text: string): string | undefined {
  if (!text) return undefined;
  // Elfa chat frequently opens with "# TL;DR:\n..." — grab that block if present.
  const tldrMatch = text.match(/#\s*TL;DR:?\s*\n+([\s\S]*?)(?:\n───|\n\n[A-Z#])/);
  if (tldrMatch) return tldrMatch[1].trim().slice(0, 500);
  // Otherwise take first paragraph, capped.
  const first = text.split(/\n\s*\n/)[0];
  return first.trim().slice(0, 500);
}

async function refreshLlm(symbol: string): Promise<void> {
  if (!LLM_ENABLED) return;
  if (inflight.has(symbol)) return;

  const task = (async () => {
    try {
      const res = await elfa.chatAnalysis(
        `Current sentiment for ${symbol}`,
        "tokenAnalysis",
        symbol,
      );
      const text: string = res?.data?.message || "";
      const parsed = parseLlmSentiment(text);

      const existing = cache.get(symbol)?.result ?? (await computeEngagementProxy(symbol));
      if (parsed) {
        cache.set(symbol, {
          result: {
            ...existing,
            bullishPercent: parsed.bullishPercent,
            source: "llm",
            confidence: parsed.confidence,
            summary: extractSummary(text),
            lastUpdated: Date.now(),
            refreshing: false,
          },
          fetchedAt: Date.now(),
        });
      } else {
        // LLM returned text but couldn't parse — keep existing, just stamp time.
        cache.set(symbol, {
          result: { ...existing, refreshing: false, lastUpdated: Date.now() },
          fetchedAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn(`[Sentiment] LLM refresh failed for ${symbol}:`, (err as Error).message);
      // Mark not-refreshing so subsequent requests will retry after next TTL.
      const existing = cache.get(symbol);
      if (existing) existing.result.refreshing = false;
    } finally {
      inflight.delete(symbol);
    }
  })();

  inflight.set(symbol, task);
}

export async function getSentiment(symbol: string): Promise<SentimentResult> {
  const sym = symbol.toUpperCase();
  const now = Date.now();
  const cached = cache.get(sym);

  if (cached && now - cached.fetchedAt < TTL_MS) {
    return cached.result;
  }

  // Cache miss or stale. Ensure we have *something* to return immediately.
  if (!cached) {
    const proxy = await computeEngagementProxy(sym);
    proxy.refreshing = LLM_ENABLED;
    cache.set(sym, { result: proxy, fetchedAt: now });
    refreshLlm(sym); // fire-and-forget
    return proxy;
  }

  // Stale: return last known result, kick off background refresh.
  cached.result.refreshing = LLM_ENABLED;
  refreshLlm(sym);
  return cached.result;
}
