"use client";

import { useEffect, useRef } from "react";
import { useAppKitAccount } from "@reown/appkit/react";
import { useStore } from "@/store/useStore";
import { fetchBalance } from "@/lib/api";

export default function BalanceSync() {
  const { address, isConnected } = useAppKitAccount();
  const setBalance = useStore((s) => s.setBalance);
  const setWalletAddress = useStore((s) => s.setWalletAddress);
  // Ref that reads pendingVotes at call-time so the interval callback sees
  // the latest count without needing to be restarted on every vote.
  const storeRef = useRef(useStore.getState);
  storeRef.current = useStore.getState;

  useEffect(() => {
    setWalletAddress(isConnected && address ? address : null);

    if (!isConnected || !address) {
      setBalance(0);
      return;
    }

    const load = () => {
      // While there are pending (optimistic) votes, the FE balance is ahead
      // of the server. Overwriting with the server value would "undo" the
      // local debit for a brief flash before confirmOptimisticVote reconciles.
      // Skip polling until all pending votes have landed.
      if (storeRef.current().pendingVotes.length > 0) return;
      fetchBalance(address).then((d) => {
        // Re-check: a vote could have gone pending between fetch dispatch and response.
        if (storeRef.current().pendingVotes.length > 0) return;
        setBalance(d.balance);
      }).catch(() => {});
    };

    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [address, isConnected, setBalance, setWalletAddress]);

  return null;
}
