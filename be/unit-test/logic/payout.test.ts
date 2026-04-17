import { computePayouts } from "../../src/lib/payoutWeight";

describe("Payout Logic (computePayouts)", () => {
  const mockVotes: any[] = [
    { id: "1", userWallet: "A", side: "yes", amount: 100, shareWeight: 100 },
    { id: "2", userWallet: "B", side: "yes", amount: 100, shareWeight: 50 }, // Joined late, 50% weight
    { id: "3", userWallet: "C", side: "no", amount: 200, shareWeight: 200 },
  ];

  it("should calculate correct payouts for 'yes' winners", () => {
    const outcomes = computePayouts(mockVotes, "yes");
    
    const winnerA = outcomes.find(o => o.wallet === "A");
    const winnerB = outcomes.find(o => o.wallet === "B");
    const loserC = outcomes.find(o => o.wallet === "C");

    expect(winnerA?.won).toBe(true);
    expect(winnerB?.won).toBe(true);
    expect(loserC?.won).toBe(false);

    // Total winners weighted pool = (100) + (50) = 150
    // Total losers pool = 200
    // Total pool = 100 + 100 + 200 = 400
    // Winner A gets: (100/150) * 400 = 266.66
    // Winner B gets: (50/150) * 400 = 133.33
    
    expect(winnerA?.payout).toBeCloseTo(266.66, 1);
    expect(winnerB?.payout).toBeCloseTo(133.33, 1);
    expect(loserC?.payout).toBe(0);
  });

  it("should calculate correct payouts for 'no' winners", () => {
    const outcomes = computePayouts(mockVotes, "no");
    const winnerC = outcomes.find(o => o.wallet === "C");
    
    expect(winnerC?.won).toBe(true);
    // Winner C gets: (200/200) * 400 = 400
    expect(winnerC?.payout).toBe(400);
  });
});
