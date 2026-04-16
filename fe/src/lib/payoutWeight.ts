// Client-side mirror of be/src/lib/payoutWeight.ts.
// Kept in lockstep with the BE implementation so the TradeModal can preview
// the effective share weight before the user confirms. A mismatch would show
// the user a different multiplier than they actually receive — keep the two
// files side-by-side and update both.

export const MIN_SHARE_WEIGHT = 0.1;

export interface WeightInputs {
  targetPoolBefore: number;
  oppositePoolBefore: number;
  deadline: number;
  now: number;
  durationMin: number;
}

export function computeShareWeight(input: WeightInputs): number {
  const { targetPoolBefore, oppositePoolBefore, deadline, now, durationMin } = input;
  const durationMs = Math.max(1, durationMin * 60_000);
  const remaining = Math.max(0, Math.min(durationMs, deadline - now));
  const timeFraction = remaining / durationMs;
  const totalPool = targetPoolBefore + oppositePoolBefore;
  const p = totalPool > 0 ? targetPoolBefore / totalPool : 0.5;
  const favoriteBias = Math.max(0, 2 * p - 1);
  const urgency = 1 - timeFraction;
  const raw = 1 - urgency * favoriteBias;
  return Math.max(MIN_SHARE_WEIGHT, Math.min(1, raw));
}

/** UX helper: classify weight into bands for coloring + copy. */
export function describeWeight(weight: number): {
  band: "full" | "reduced" | "heavy" | "floor";
  label: string;
  color: string;
} {
  if (weight >= 0.95) return { band: "full", label: "Full share", color: "#00b482" };
  if (weight >= 0.7) return { band: "reduced", label: `${(weight * 100).toFixed(0)}% share`, color: "#e3b341" };
  if (weight > MIN_SHARE_WEIGHT + 0.01) return { band: "heavy", label: `${(weight * 100).toFixed(0)}% share — late bet`, color: "#f59e0b" };
  return { band: "floor", label: `Min share (${(MIN_SHARE_WEIGHT * 100).toFixed(0)}%) — too late / obvious favorite`, color: "#dc3246" };
}
