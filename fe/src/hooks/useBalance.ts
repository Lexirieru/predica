"use client";

import { useState, useEffect, useCallback } from "react";

const RPC_URL = "https://api.devnet.solana.com";

interface Balances {
  sol: number;
  usdp: number | null; // null = unknown token address
  loading: boolean;
}

export function useBalance(walletAddress: string | undefined): Balances {
  const [balances, setBalances] = useState<Balances>({ sol: 0, usdp: null, loading: true });

  const fetchBalances = useCallback(async () => {
    if (!walletAddress) {
      setBalances({ sol: 0, usdp: null, loading: false });
      return;
    }

    try {
      // Fetch SOL balance
      const solRes = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBalance",
          params: [walletAddress],
        }),
      });
      const solData = await solRes.json();
      const solBalance = (solData?.result?.value || 0) / 1e9;

      // Fetch all SPL token accounts to find USDP
      const tokenRes = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "getTokenAccountsByOwner",
          params: [
            walletAddress,
            { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
            { encoding: "jsonParsed" },
          ],
        }),
      });
      const tokenData = await tokenRes.json();
      const accounts = tokenData?.result?.value || [];

      // Look for USDP — find the largest stablecoin-like balance (6 decimals, name hint)
      let usdpBalance: number | null = null;
      for (const acc of accounts) {
        const info = acc.account?.data?.parsed?.info;
        if (!info) continue;
        const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
        const decimals = info.tokenAmount?.decimals || 0;
        // USDP on Pacifica testnet likely has 6 decimals like USDC
        if (decimals === 6 && amount > 0) {
          // Take the largest 6-decimal token as USDP candidate
          if (usdpBalance === null || amount > usdpBalance) {
            usdpBalance = amount;
          }
        }
      }

      setBalances({ sol: solBalance, usdp: usdpBalance, loading: false });
    } catch {
      setBalances({ sol: 0, usdp: null, loading: false });
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  return balances;
}
