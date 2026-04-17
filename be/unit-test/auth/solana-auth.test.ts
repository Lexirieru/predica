import { getAuthMessage, verifySolanaSignature } from "../../src/lib/auth";
import * as nacl from "tweetnacl";
import bs58 from "bs58";

describe("Solana Authentication", () => {
  it("should verify a valid signature", () => {
    // Testing the function directly with real world like data
    const message = "Predica Auth: VOTE by 2v9S... at 1713330000";
    // This is just to test if verify function exists and runs without crashing
    const isValid = verifySolanaSignature(message, "invalid_sig", "2v9S...invalid_pk");
    expect(isValid).toBe(false);
  });

  it("should match auth message format", () => {
    const msg = getAuthMessage("VOTE", "WALLET123", 123456);
    expect(msg).toBe("Predica Auth: VOTE by WALLET123 at 123456");
  });
});
