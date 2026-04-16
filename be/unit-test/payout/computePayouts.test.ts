import { describe, it, expect } from "@jest/globals";
import { computePayouts, VoteLike } from "../../src/lib/payoutWeight";

function vote(partial: Partial<VoteLike> & { id: string }): VoteLike {
  return {
    userWallet: `w_${partial.id}`,
    side: "yes",
    amount: 10,
    shareWeight: 10, // default full weight unless overridden
    ...partial,
  };
}

describe("computePayouts — settlement math", () => {
  it("single winner takes the whole pool", () => {
    const votes: VoteLike[] = [
      vote({ id: "v1", side: "yes", amount: 100, shareWeight: 100 }),
      vote({ id: "v2", side: "no", amount: 50, shareWeight: 50 }),
    ];
    const out = computePayouts(votes, "yes");
    const winner = out.find((o) => o.voteId === "v1")!;
    const loser = out.find((o) => o.voteId === "v2")!;
    expect(winner.won).toBe(true);
    expect(winner.payout).toBe(150); // full pool
    expect(winner.profit).toBe(50);
    expect(loser.won).toBe(false);
    expect(loser.payout).toBe(0);
    expect(loser.profit).toBe(-50);
  });

  it("equal-weight winners split proportionally by amount", () => {
    // When shareWeight == amount for everyone, outcome matches classic pari-mutuel.
    const votes: VoteLike[] = [
      vote({ id: "v1", side: "yes", amount: 30, shareWeight: 30 }),
      vote({ id: "v2", side: "yes", amount: 10, shareWeight: 10 }),
      vote({ id: "v3", side: "no", amount: 20, shareWeight: 20 }),
    ];
    const out = computePayouts(votes, "yes");
    const v1 = out.find((o) => o.voteId === "v1")!;
    const v2 = out.find((o) => o.voteId === "v2")!;
    // Total pool = 60. v1 share = 30/40 = 0.75 → 45. v2 share = 10/40 = 0.25 → 15.
    expect(v1.payout).toBeCloseTo(45, 6);
    expect(v2.payout).toBeCloseTo(15, 6);
    expect(v1.payout + v2.payout).toBeCloseTo(60, 6); // pool fully distributed
  });

  it("hybrid weighting: late whale on favorite gets LESS than raw-amount split", () => {
    // Early 10 small YES bets, each full-weight.
    const early: VoteLike[] = Array.from({ length: 10 }, (_, i) => ({
      id: `early_${i}`,
      userWallet: `w_early_${i}`,
      side: "yes",
      amount: 10,
      shareWeight: 10, // full weight (1.0)
    }));
    // Late whale on YES with 0.5 weight applied (e.g. 75% favorite at deadline)
    const whale: VoteLike = {
      id: "whale",
      userWallet: "w_whale",
      side: "yes",
      amount: 1000,
      shareWeight: 500, // 0.5 * 1000
    };
    // One NO bettor
    const no: VoteLike = { id: "no", userWallet: "w_no", side: "no", amount: 200, shareWeight: 200 };

    const out = computePayouts([...early, whale, no], "yes");

    // Total pool = 100 + 1000 + 200 = 1300
    // Weighted winner pool = 100 (early) + 500 (whale) = 600
    // Whale share = 500/600 ≈ 0.833 → payout ≈ 1083.33
    const whaleOut = out.find((o) => o.voteId === "whale")!;
    expect(whaleOut.payout).toBeCloseTo(1083.333, 2);

    // Early aggregated: share = 100/600 ≈ 0.167 → payout ≈ 216.67 collectively
    const earlyTotal = out
      .filter((o) => o.voteId.startsWith("early_"))
      .reduce((s, o) => s + o.payout, 0);
    expect(earlyTotal).toBeCloseTo(216.667, 2);

    // Pool fully distributed
    const totalWinnerPayout = whaleOut.payout + earlyTotal;
    expect(totalWinnerPayout).toBeCloseTo(1300, 2);

    // Compare vs. raw-amount split: whale would've gotten 1000/1100 * 1300 = 1181.82
    // With weighting, whale gets 1083.33 — about $98 less. Early bettors pick it up.
    expect(whaleOut.payout).toBeLessThan(1181.82);
    expect(earlyTotal).toBeGreaterThan(118.18);
  });

  it("legacy fallback: any winner with shareWeight=0 reverts the whole split to amount-weighted", () => {
    // Mixed: one legacy winner (shareWeight=0) + one new winner (shareWeight=5)
    const votes: VoteLike[] = [
      { id: "legacy", userWallet: "w_l", side: "yes", amount: 100, shareWeight: 0 },
      { id: "new", userWallet: "w_n", side: "yes", amount: 100, shareWeight: 5 },
      { id: "loser", userWallet: "w_x", side: "no", amount: 100, shareWeight: 100 },
    ];
    const out = computePayouts(votes, "yes");
    const legacy = out.find((o) => o.voteId === "legacy")!;
    const neu = out.find((o) => o.voteId === "new")!;
    // Amount-weighted fallback: each winner = 100/200 * 300 = 150
    expect(legacy.payout).toBeCloseTo(150, 6);
    expect(neu.payout).toBeCloseTo(150, 6);
  });

  it("no winners → pool stays unclaimed (sanity check)", () => {
    // All votes on NO, YES wins → no one gets paid but losers still lose.
    const votes: VoteLike[] = [
      { id: "a", userWallet: "wa", side: "no", amount: 50, shareWeight: 50 },
      { id: "b", userWallet: "wb", side: "no", amount: 50, shareWeight: 50 },
    ];
    const out = computePayouts(votes, "yes");
    expect(out.every((o) => !o.won)).toBe(true);
    expect(out.every((o) => o.payout === 0)).toBe(true);
  });

  it("empty vote list returns empty outcomes", () => {
    expect(computePayouts([], "yes")).toEqual([]);
  });

  it("total payout to winners equals total pool (no money created / destroyed)", () => {
    const votes: VoteLike[] = [
      { id: "a", userWallet: "wa", side: "yes", amount: 17, shareWeight: 8.5 }, // late whale
      { id: "b", userWallet: "wb", side: "yes", amount: 3, shareWeight: 3 },
      { id: "c", userWallet: "wc", side: "yes", amount: 5, shareWeight: 5 },
      { id: "d", userWallet: "wd", side: "no", amount: 13, shareWeight: 13 },
      { id: "e", userWallet: "we", side: "no", amount: 4, shareWeight: 4 },
    ];
    const pool = 17 + 3 + 5 + 13 + 4;
    const out = computePayouts(votes, "yes");
    const totalWinnerPayout = out.filter((o) => o.won).reduce((s, o) => s + o.payout, 0);
    expect(totalWinnerPayout).toBeCloseTo(pool, 6);
  });
});
