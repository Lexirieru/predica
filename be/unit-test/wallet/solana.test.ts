import { verifyDeposit } from "../../src/lib/solana";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

describe("Solana Lib - Deposit Verification (Robustness)", () => {
  const mockBackendWallet = "8SnuZxuTXWRfmHPypqCAq7tFeqboSkyAtrd9ng34VPBy";
  const mockUserWallet = "UserWalletAddress111111111111111111111111";
  const mockMint = "USDPqRbLidFGufty2s3oizmDEKdqx7ePTqzDMbf5ZKM";

  const mockConn = {
    getParsedTransaction: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockConn.getParsedTransaction as any).mockReset();
    
    // Create a keypair that matches our mock backend address
    // This is just a trick: we want the public key to match
    // In the real code, getBackendKeypair() is called.
    // We'll mock bs58.decode or set the env var to a known keypair.
    const kp = Keypair.generate();
    // Use a fixed "backend" keypair for the test
    process.env.SOLANA_PRIVATE_KEY = bs58.encode(kp.secretKey);
    process.env.USDP_MINT = mockMint;
    
    // Actually, we need to know the address to put in the mock tx
    const backendAddress = kp.publicKey.toBase58();

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should verify a valid USDP deposit transaction", async () => {
    const backendAddress = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!)).publicKey.toBase58();
    const mockTx = {
      meta: {
        preTokenBalances: [
          { owner: mockUserWallet, mint: mockMint, accountIndex: 1, uiTokenAmount: { uiAmountString: "100" } },
          { owner: backendAddress, mint: mockMint, accountIndex: 2, uiTokenAmount: { uiAmountString: "50" } }
        ],
        postTokenBalances: [
          { owner: mockUserWallet, mint: mockMint, accountIndex: 1, uiTokenAmount: { uiAmountString: "90" } },
          { owner: backendAddress, mint: mockMint, accountIndex: 2, uiTokenAmount: { uiAmountString: "60" } }
        ],
        innerInstructions: []
      },
      transaction: { message: { instructions: [{ program: "spl-token" }] } }
    };

    (mockConn.getParsedTransaction as any).mockResolvedValue(mockTx);
    
    const promise = verifyDeposit("valid_sig", 10, mockUserWallet, mockConn);
    const result = await promise;
    expect(result).toBe(true);
  });

  it("should retry if transaction is not found initially (Retry Logic)", async () => {
    const backendAddress = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!)).publicKey.toBase58();
    const mockTx = {
      meta: {
        preTokenBalances: [
          { owner: mockUserWallet, mint: mockMint, accountIndex: 1, uiTokenAmount: { uiAmountString: "100" } },
          { owner: backendAddress, mint: mockMint, accountIndex: 2, uiTokenAmount: { uiAmountString: "0" } }
        ],
        postTokenBalances: [
          { owner: mockUserWallet, mint: mockMint, accountIndex: 1, uiTokenAmount: { uiAmountString: "90" } },
          { owner: backendAddress, mint: mockMint, accountIndex: 2, uiTokenAmount: { uiAmountString: "10" } }
        ],
        innerInstructions: []
      },
      transaction: { message: { instructions: [{ program: "spl-token" }] } }
    };

    (mockConn.getParsedTransaction as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(mockTx);

    const promise = verifyDeposit("retry_sig", 10, mockUserWallet, mockConn);
    
    for (let i = 0; i < 2; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    }

    const result = await promise;
    expect(result).toBe(true);
    expect(mockConn.getParsedTransaction).toHaveBeenCalledTimes(3);
  });

  it("should fail if amount received is less than expected", async () => {
    const backendAddress = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!)).publicKey.toBase58();
    const mockTx = {
      meta: {
        preTokenBalances: [{ owner: backendAddress, mint: mockMint, accountIndex: 2, uiTokenAmount: { uiAmountString: "0" } }],
        postTokenBalances: [{ owner: backendAddress, mint: mockMint, accountIndex: 2, uiTokenAmount: { uiAmountString: "5" } }],
        innerInstructions: []
      },
      transaction: { message: { instructions: [{ program: "spl-token" }] } }
    };

    (mockConn.getParsedTransaction as any).mockResolvedValue(mockTx);

    const result = await verifyDeposit("low_amount_sig", 10, mockUserWallet, mockConn);
    expect(result).toBe(false);
  });

  it("should fail if the mint address is wrong (Fake Token Attack)", async () => {
    const backendAddress = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!)).publicKey.toBase58();
    const mockTx = {
      meta: {
        preTokenBalances: [{ owner: backendAddress, mint: "FAKE_MINT", accountIndex: 2, uiTokenAmount: { uiAmountString: "0" } }],
        postTokenBalances: [{ owner: backendAddress, mint: "FAKE_MINT", accountIndex: 2, uiTokenAmount: { uiAmountString: "10" } }],
        innerInstructions: []
      },
      transaction: { message: { instructions: [{ program: "spl-token" }] } }
    };

    (mockConn.getParsedTransaction as any).mockResolvedValue(mockTx);

    const result = await verifyDeposit("fake_mint_sig", 10, mockUserWallet, mockConn);
    expect(result).toBe(false);
  });
});
