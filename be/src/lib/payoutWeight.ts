/**
 * Hybrid anti-late-bet mechanism.
 *
 * Pari-mutuel payouts leak value when someone bets big on the obvious side
 * at the last second — the pool hasn't re-balanced, so they extract ROI
 * disproportionate to actual risk. Polymarket doesn't have this issue because
 * the order book continuously prices the asymmetry; our pool can't, so we
 * apply a per-vote "share weight" that reduces how much of the winning pool
 * a late bet to the favorite claims.
 *
 * Contract:
 *   - Bets on the underdog side (implied prob <= 0.5) are never penalized.
 *   - Bets placed with lots of time left (timeFraction near 1.0) are never
 *     penalized.
 *   - Penalty grows smoothly in BOTH time-elapsed AND probability-of-favorite.
 *   - A floor prevents weight from collapsing to 0 (keeps math numerically
 *     stable and preserves at least token upside for the worst-timed bet).
 *
 * Formula:
 *   weight = clamp(1 - (1 - timeFraction) * max(0, 2p - 1), MIN_FLOOR, 1)
 *
 * Where:
 *   timeFraction = (deadline - now) / MARKET_DURATION_MS, clamped to [0, 1]
 *   p            = implied probability of the side being bet, computed from
 *                  the pool state JUST BEFORE this bet is added
 *
 * Worked examples:
 *   - First bet in empty market, any time: p = 0.5, weight = 1.0
 *   - Bet on 50-50 market at any time: 2p-1 = 0, weight = 1.0
 *   - Bet on 75% favorite at t=0: timeFraction = 1, weight = 1.0
 *   - Bet on 75% favorite at deadline: timeFraction = 0, weight = 1 - 1*0.5 = 0.5
 *   - Bet on 99% favorite with 10% time left: timeFraction = 0.1,
 *     weight = 1 - 0.9 * 0.98 = 0.118
 *   - Bet on underdog side (p = 0.2) at deadline: 2p-1 < 0, weight = 1.0
 */

export const MIN_SHARE_WEIGHT = 0.1; // never punish a bet to less than 10% share
const MARKET_DURATION_MS = 5 * 60_000;

export interface WeightInputs {
  /** Pool size on the side the user is betting, BEFORE this bet. */
  targetPoolBefore: number;
  /** Pool size on the opposite side, BEFORE this bet. */
  oppositePoolBefore: number;
  /** ms timestamp when the market deadline fires. */
  deadline: number;
  /** ms timestamp when the bet is being placed (server clock). */
  now: number;
}

/**
 * Compute the share weight multiplier (0..1) for a single bet.
 */
export function computeShareWeight(input: WeightInputs): number {
  const { targetPoolBefore, oppositePoolBefore, deadline, now } = input;

  // timeFraction: 1.0 at market open, 0.0 at deadline, clamped.
  const remaining = Math.max(0, Math.min(MARKET_DURATION_MS, deadline - now));
  const timeFraction = remaining / MARKET_DURATION_MS;

  // Implied probability of the side being bet. Empty pool => 0.5 (no crowd yet).
  const totalPool = targetPoolBefore + oppositePoolBefore;
  const p = totalPool > 0 ? targetPoolBefore / totalPool : 0.5;

  // Favorite bias: 0 when p <= 0.5, scales up to 1 when p = 1.0.
  const favoriteBias = Math.max(0, 2 * p - 1);

  // Urgency: 0 at market open, 1 at deadline.
  const urgency = 1 - timeFraction;

  const rawWeight = 1 - urgency * favoriteBias;

  // Floor prevents total obliteration of upside; ceiling is 1 by construction.
  return Math.max(MIN_SHARE_WEIGHT, Math.min(1, rawWeight));
}

/**
 * Apply the weight to a bet amount. Pure helper so callers don't have to
 * repeat the multiplication + rounding policy.
 */
export function computeShareAmount(amount: number, weight: number): number {
  return amount * weight;
}

export interface VoteLike {
  id: string;
  userWallet: string;
  side: "yes" | "no";
  amount: number;
  shareWeight: number; // 0 indicates legacy pre-hybrid row
}

export interface PayoutOutcome {
  voteId: string;
  wallet: string;
  won: boolean;
  amount: number;
  payout: number;
  profit: number;
}

/**
 * Given the full vote list for a market that just resolved, compute per-user
 * payouts. Extracted from the settlement cron so it can be unit-tested without
 * a DB — feed it fixtures, assert the math.
 *
 * Fallback: if any winning vote has shareWeight <= 0 (legacy row written
 * before the hybrid column existed), the entire split reverts to amount-
 * weighted. Mixing would over-tax the already-weighted votes.
 */
export function computePayouts(
  votes: VoteLike[],
  resolution: "yes" | "no",
): PayoutOutcome[] {
  const totalPool = votes.reduce((s, v) => s + v.amount, 0);
  const winners = votes.filter((v) => v.side === resolution);
  const losers = votes.filter((v) => v.side !== resolution);

  const hasLegacyWinner = winners.some((v) => !(Number(v.shareWeight) > 0));
  const useWeighted = !hasLegacyWinner;
  const weightTotal = useWeighted
    ? winners.reduce((s, v) => s + Number(v.shareWeight), 0)
    : winners.reduce((s, v) => s + v.amount, 0);

  const outcomes: PayoutOutcome[] = [];

  for (const v of winners) {
    const numerator = useWeighted ? Number(v.shareWeight) : v.amount;
    const share = weightTotal > 0 ? numerator / weightTotal : 0;
    const payout = share * totalPool;
    outcomes.push({
      voteId: v.id,
      wallet: v.userWallet,
      won: true,
      amount: v.amount,
      payout,
      profit: payout - v.amount,
    });
  }

  for (const v of losers) {
    outcomes.push({
      voteId: v.id,
      wallet: v.userWallet,
      won: false,
      amount: v.amount,
      payout: 0,
      profit: -v.amount,
    });
  }

  return outcomes;
}
