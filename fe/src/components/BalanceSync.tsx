"use client";

import { useEffect } from "react";
import { useAppKitAccount } from "@reown/appkit/react";
import { useStore } from "@/store/useStore";
import { fetchBalance } from "@/lib/api";

export default function BalanceSync() {
  const { address, isConnected } = useAppKitAccount();
  const setBalance = useStore((s) => s.setBalance);
  const setWalletAddress = useStore((s) => s.setWalletAddress);

  useEffect(() => {
    setWalletAddress(isConnected && address ? address : null);

    if (!isConnected || !address) {
      setBalance(0);
      return;
    }

    const load = () => {
      fetchBalance(address).then((d) => setBalance(d.balance)).catch(() => {});
    };

    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [address, isConnected, setBalance, setWalletAddress]);

  return null;
}
