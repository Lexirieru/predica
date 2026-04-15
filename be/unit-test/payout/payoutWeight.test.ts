import { describe, it, expect } from "@jest/globals";
import { computeShareWeight, computeShareAmount, MIN_SHARE_WEIGHT } from "../../src/lib/payoutWeight";

// All scenarios assume a 5-minute market unless otherwise noted.
const DURATION_MIN = 5;
const DEADLINE = 1_700_000_000_000; // arbitrary fixed timestamp
const durationMs = DURATION_MIN * 60_000;

function at(fractionRemaining: number): number {
  // Helper: `now` such that (deadline - now) / durationMs == fractionRemaining.
  return DEADLINE - Math.round(fractionRemaining * durationMs);
}

describe("computeShareWeight", () => {
  describe("no-penalty zones", () => {
    it("first bet in empty market → weight 1.0 regardless of time", () => {
      const w = computeShareWeight({
        targetPoolBefore: 0,
        oppositePoolBefore: 0,
        deadline: DEADLINE,
        now: at(0), // zero time remaining
        durationMin: DURATION_MIN,
      });
      expect(w).toBe(1);
    });

    it("balanced 50-50 pool at any time → weight 1.0", () => {
      for (const frac of [1, 0.5, 0.1, 0]) {
        const w = computeShareWeight({
          targetPoolBefore: 100,
          oppositePoolBefore: 100,
          deadline: DEADLINE,
          now: at(frac),
          durationMin: DURATION_MIN,
        });
        expect(w).toBe(1);
      }
    });

    it("bet on underdog side (p<0.5) is never penalized", () => {
      // Target side has 10, opposite has 90 → p_target = 0.1
      for (const frac of [1, 0.5, 0.01, 0]) {
        const w = computeShareWeight({
          targetPoolBefore: 10,
          oppositePoolBefore: 90,
          deadline: DEADLINE,
          now: at(frac),
          durationMin: DURATION_MIN,
        });
        expect(w).toBe(1);
      }
    });

    it("bet at market open (timeFraction = 1) is never penalized", () => {
      // Even on an obvious favorite
      const w = computeShareWeight({
        targetPoolBefore: 990,
        oppositePoolBefore: 10,
        deadline: DEADLINE,
        now: at(1),
        durationMin: DURATION_MIN,
      });
      expect(w).toBe(1);
    });
  });

  describe("graded penalty on the favorite side", () => {
    it("75% favorite at deadline (timeFraction=0) → weight 0.5", () => {
      // p = 0.75, urgency = 1 → weight = 1 - 1 * 0.5 = 0.5
      const w = computeShareWeight({
        targetPoolBefore: 75,
        oppositePoolBefore: 25,
        deadline: DEADLINE,
        now: at(0),
        durationMin: DURATION_MIN,
      });
      expect(w).toBeCloseTo(0.5, 4);
    });

    it("75% favorite halfway through → weight 0.75", () => {
      // urgency = 0.5, favoriteBias = 0.5 → weight = 1 - 0.25 = 0.75
      const w = computeShareWeight({
        targetPoolBefore: 75,
        oppositePoolBefore: 25,
        deadline: DEADLINE,
        now: at(0.5),
        durationMin: DURATION_MIN,
      });
      expect(w).toBeCloseTo(0.75, 4);
    });

    it("99% favorite with 10% time remaining hits the floor", () => {
      // p = 0.99, favoriteBias = 0.98, urgency = 0.9 → raw = 1 - 0.882 = 0.118
      // Floor is 0.1, so 0.118 stays (above floor).
      const w = computeShareWeight({
        targetPoolBefore: 990,
        oppositePoolBefore: 10,
        deadline: DEADLINE,
        now: at(0.1),
        durationMin: DURATION_MIN,
      });
      expect(w).toBeCloseTo(0.118, 3);
      expect(w).toBeGreaterThan(MIN_SHARE_WEIGHT);
    });

    it("100% favorite at deadline clamps to MIN_SHARE_WEIGHT (floor)", () => {
      // targetPool=100, oppositePool=0 → p = 1.0, urgency = 1 → raw = 0
      const w = computeShareWeight({
        targetPoolBefore: 100,
        oppositePoolBefore: 0,
        deadline: DEADLINE,
        now: at(0),
        durationMin: DURATION_MIN,
      });
      expect(w).toBe(MIN_SHARE_WEIGHT);
    });
  });

  describe("boundary + robustness", () => {
    it("negative time remaining (past deadline) treated as timeFraction 0", () => {
      const w = computeShareWeight({
        targetPoolBefore: 75,
        oppositePoolBefore: 25,
        deadline: DEADLINE,
        now: DEADLINE + 60_000, // 1 min past deadline
        durationMin: DURATION_MIN,
      });
      // Same as `at(0)` → 0.5
      expect(w).toBeCloseTo(0.5, 4);
    });

    it("time > duration (somehow) clamps timeFraction to 1", () => {
      const w = computeShareWeight({
        targetPoolBefore: 90,
        oppositePoolBefore: 10,
        deadline: DEADLINE,
        now: DEADLINE - durationMs * 2, // way before market existed
        durationMin: DURATION_MIN,
      });
      // timeFraction = 1 → weight = 1
      expect(w).toBe(1);
    });

    it("different duration values work (1m and 15m)", () => {
      // 1m market, 75-25, halfway → weight 0.75 (duration-independent shape)
      const w1 = computeShareWeight({
        targetPoolBefore: 75,
        oppositePoolBefore: 25,
        deadline: DEADLINE,
        now: DEADLINE - 30_000, // 30s of a 1m market = halfway
        durationMin: 1,
      });
      expect(w1).toBeCloseTo(0.75, 4);

      const w15 = computeShareWeight({
        targetPoolBefore: 75,
        oppositePoolBefore: 25,
        deadline: DEADLINE,
        now: DEADLINE - 7.5 * 60_000, // halfway
        durationMin: 15,
      });
      expect(w15).toBeCloseTo(0.75, 4);
    });

    it("weight is monotonically non-increasing in `now` for a fixed favorite", () => {
      // As time elapses (now increases), weight should decrease or stay equal.
      const common = {
        targetPoolBefore: 80,
        oppositePoolBefore: 20,
        deadline: DEADLINE,
        durationMin: DURATION_MIN,
      };
      const samples = [1, 0.8, 0.5, 0.25, 0.1, 0].map((f) =>
        computeShareWeight({ ...common, now: at(f) }),
      );
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-9);
      }
    });
  });
});

describe("computeShareAmount", () => {
  it("applies weight multiplicatively", () => {
    expect(computeShareAmount(100, 0.5)).toBe(50);
    expect(computeShareAmount(100, 1)).toBe(100);
    expect(computeShareAmount(0, 0.5)).toBe(0);
  });
});

describe("realistic settlement scenario", () => {
  // Simulate a full market: pool builds up, a late whale piles onto the
  // favorite. Verify the weighted split actually protects early bettors.
  it("late-whale on favorite gets dramatically less share than early bettors", () => {
    // Early bettors (at market open): 10 users × $10 on YES
    const earlyVotes = Array.from({ length: 10 }, () => ({
      amount: 10,
      weight: computeShareWeight({
        targetPoolBefore: 0, // each enters in order; we simplify: first in
        oppositePoolBefore: 0,
        deadline: DEADLINE,
        now: at(1),
        durationMin: DURATION_MIN,
      }),
      label: "early" as const,
    }));

    // Late whale at 5% time remaining, joining YES when pool is already 100 YES / 50 NO
    const whaleVote = {
      amount: 1000,
      weight: computeShareWeight({
        targetPoolBefore: 100,
        oppositePoolBefore: 50,
        deadline: DEADLINE,
        now: at(0.05),
        durationMin: DURATION_MIN,
      }),
      label: "whale" as const,
    };

    const allVotes = [...earlyVotes, whaleVote];

    // All early bettors get full weight
    earlyVotes.forEach((v) => expect(v.weight).toBe(1));

    // Whale weight: p = 100/150 = 0.667, favoriteBias = 0.333, urgency = 0.95
    // raw = 1 - 0.95 * 0.333 = 0.683
    expect(whaleVote.weight).toBeGreaterThan(0.6);
    expect(whaleVote.weight).toBeLessThan(0.75);

    // Compare whale's effective share vs. raw-amount share
    const rawWhaleShare = whaleVote.amount / (10 * 10 + whaleVote.amount); // 1000 / 1100 = 0.909
    const totalWeight = earlyVotes.reduce((s, v) => s + v.amount * v.weight, 0) + whaleVote.amount * whaleVote.weight;
    const weightedWhaleShare = (whaleVote.amount * whaleVote.weight) / totalWeight;

    // Whale's weighted share should be strictly less than its raw share.
    expect(weightedWhaleShare).toBeLessThan(rawWhaleShare);
    // Early bettors collectively gain share relative to the raw-amount case.
    const earlyRawShare = (10 * 10) / (10 * 10 + whaleVote.amount);
    const earlyWeightedShare = 1 - weightedWhaleShare;
    expect(earlyWeightedShare).toBeGreaterThan(earlyRawShare);
  });
});
