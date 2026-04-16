"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAppKitAccount, useAppKit } from "@reown/appkit/react";
import { fetchUserVotes, fetchTransactions } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import dynamic from "next/dynamic";
// Deposit/Withdraw modals pull @solana/spl-token + wallet tx building; defer
// those bytes until the user actually opens one of the modals.
const DepositModal = dynamic(() => import("@/components/DepositModal"), { ssr: false });
const WithdrawModal = dynamic(() => import("@/components/WithdrawModal"), { ssr: false });
import PnlChart from "@/components/PnlChart";
import NotificationToggle from "@/components/NotificationToggle";

// All timestamps render in UTC — consistent across every user regardless of
// local TZ, matching how BE stores deadlines.
const UTC_DATETIME = new Intl.DateTimeFormat("en-GB", {
  year: "numeric", month: "short", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
  timeZone: "UTC",
});
const UTC_DATE = new Intl.DateTimeFormat("en-GB", {
  year: "numeric", month: "short", day: "2-digit",
  timeZone: "UTC",
});

interface VoteEntry {
  id: string;
  marketId: string;
  side: string;
  amount: number;
  payout: number;
  status: string;
  createdAt: number;
  // Enriched via backend left-join (see be commit 34703eb)
  marketSymbol?: string;
  marketQuestion?: string;
  marketTargetPrice?: number;
  marketResolution?: "yes" | "no" | null;
  marketDeadline?: number;
  marketStatus?: string;
}

interface TxEntry {
  id: string;
  type: string;
  amount: number;
  txSignature: string | null;
  status: string;
  createdAt: number;
  metadata: string | null;
}

type Tab = "votes" | "transactions";

export default function ProfilePage() {
  const { address: wallet, isConnected: authenticated } = useAppKitAccount();
  const { open: openAppKit } = useAppKit();
  const balance = useStore((s) => s.balance);
  const [votes, setVotes] = useState<VoteEntry[]>([]);
  const [txs, setTxs] = useState<TxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("votes");

  const loadData = useCallback(async (showSpinner = false) => {
    if (!wallet) return;
    if (showSpinner) setLoading(true);
    try {
      const [votesData, txData] = await Promise.all([
        fetchUserVotes(wallet),
        fetchTransactions(wallet),
      ]);
      setVotes(votesData);
      setTxs(txData);
    } catch {}
    if (showSpinner) setLoading(false);
  }, [wallet]);

  // Initial load — show spinner. WS-triggered reloads do NOT show spinner to
  // avoid flicker when many votes settle at once.
  useEffect(() => { loadData(true); }, [loadData]);

  // Debounced reload for WS events. At 5min boundary 30+ markets settle
  // simultaneously, each triggering MARKET_RESOLVED. Without debouncing the
  // page would fire 30+ concurrent /vote+/transactions fetches in one second,
  // causing the "flicker" loading spinner spam. Coalesce into one fetch.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      loadData();
      reloadTimerRef.current = null;
    }, 500);
  }, [loadData]);
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  useWebSocket("MARKET_RESOLVED", scheduleReload);
  useWebSocket("NEW_VOTE", (data) => {
    const vote = data as { wallet: string };
    if (vote.wallet === wallet) scheduleReload();
  });

  const truncate = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  if (!authenticated) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-[var(--color-yes)] to-cyan-400 flex items-center justify-center mb-4 shadow-[0_0_24px_var(--color-yes-glow)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="#000" strokeWidth="2" />
            <path d="M20 21c0-3.314-3.582-6-8-6s-8 2.686-8 6" stroke="#000" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="text-white text-lg font-bold mb-1">Connect Wallet</h2>
        <p className="text-white/30 text-sm text-center mb-5">Connect to deposit USDP and start predicting</p>
        <button onClick={() => openAppKit()} className="px-6 py-3 rounded-2xl bg-linear-to-r from-[var(--color-yes)] to-cyan-400 text-black font-semibold text-sm">
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-white">Profile</h1>
        <p className="text-white/30 text-sm font-mono">{wallet ? truncate(wallet) : ""}</p>
      </div>

      {/* Balance card */}
      <div className="p-4 rounded-2xl bg-linear-to-br from-[#00D1A9]/10 to-transparent border border-[#00D1A9]/15 mb-4">
        <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Predica Balance</p>
        <p className="text-white text-3xl font-bold tabular-nums mb-3">${balance.toFixed(2)} <span className="text-white/30 text-sm">USDP</span></p>
        <div className="flex gap-2">
          <button onClick={() => setDepositOpen(true)}
            className="flex-1 h-10 rounded-xl font-semibold text-sm active:scale-[0.97] transition-transform"
            style={{ backgroundColor: "#00b482", color: "#fff" }}>
            Deposit
          </button>
          <button onClick={() => setWithdrawOpen(true)} disabled={balance <= 0}
            className="flex-1 h-10 rounded-xl font-semibold text-sm bg-white/6 text-white/70 border border-white/1 disabled:opacity-30 active:scale-[0.97] transition-transform">
            Withdraw
          </button>
        </div>
      </div>

      {/* Notifications toggle — only renders useful UI if BE has VAPID on */}
      <div className="mb-4">
        <NotificationToggle />
      </div>

      {/* PnL chart with range filter */}
      {votes.length > 0 && <PnlChart votes={votes} />}

      {/* Tabs */}
      <div className="flex gap-1 mb-3">
        {(["votes", "transactions"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${tab === t ? "bg-white/10 text-white" : "text-white/30"}`}>
            {t === "votes" ? "Votes" : "Transactions"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center pt-10">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : tab === "votes" ? (
        votes.length === 0 ? (
          <div className="text-center pt-10 text-white/20">
            <p className="text-sm">No votes yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {votes.slice(0, 30).map((vote) => {
              const symbol = vote.marketSymbol || "—";
              const won = vote.status === "won";
              const lost = vote.status === "lost";
              return (
              <div key={vote.id} className="flex items-center justify-between p-3 rounded-xl bg-white/2 border border-white/6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold"
                    style={{
                      backgroundColor: vote.side === "yes" ? "rgba(0,180,130,0.15)" : "rgba(220,50,70,0.15)",
                      color: vote.side === "yes" ? "#00b482" : "#dc3246",
                    }}>
                    {vote.side === "yes" ? "▲" : "▼"}
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">
                      {symbol} <span className="text-white/40">{vote.side === "yes" ? "Up" : "Down"}</span>
                    </p>
                    <p className="text-white/20 text-[10px]">
                      ${vote.amount.toFixed(2)} · {UTC_DATETIME.format(new Date(vote.createdAt))} UTC
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  {won && <p className="text-[#00b482] text-sm font-semibold tabular-nums">+${(vote.payout - vote.amount).toFixed(2)}</p>}
                  {lost && <p className="text-[#dc3246] text-sm font-semibold tabular-nums">-${vote.amount.toFixed(2)}</p>}
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: won ? "rgba(0,180,130,0.1)" : lost ? "rgba(220,50,70,0.1)" : "rgba(255,255,255,0.05)",
                      color: won ? "#00b482" : lost ? "#dc3246" : "rgba(255,255,255,0.3)",
                    }}>
                    {won ? "Won" : lost ? "Lost" : "Pending"}
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        )
      ) : (
        txs.length === 0 ? (
          <div className="text-center pt-10 text-white/20">
            <p className="text-sm">No transactions yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {txs.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-3 rounded-xl bg-white/2 border border-white/6">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    tx.type === "deposit" ? "bg-[#00b482]/15 text-[#00b482]" :
                    tx.type === "withdraw" ? "bg-white/10 text-white/50" :
                    "bg-amber-500/15 text-amber-400"
                  }`}>
                    {tx.type === "deposit" ? "+" : tx.type === "withdraw" ? "-" : "★"}
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium capitalize">{tx.type}</p>
                    <p className="text-white/20 text-[10px]">{UTC_DATE.format(new Date(tx.createdAt))} UTC</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold tabular-nums ${tx.type === "deposit" ? "text-[#00b482]" : tx.type === "payout" ? "text-amber-400" : "text-white/50"}`}>
                    {tx.type === "withdraw" ? "-" : "+"}${tx.amount.toFixed(2)}
                  </p>
                  {tx.txSignature && (
                    <a href={`https://explorer.solana.com/tx/${tx.txSignature}?cluster=devnet`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[9px] text-[#00b482]/60 hover:text-[#00b482]">
                      {tx.txSignature.slice(0, 8)}... ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} onSuccess={loadData} />
      {wallet && <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} onSuccess={loadData} wallet={wallet} balance={balance} />}
    </div>
  );
}
