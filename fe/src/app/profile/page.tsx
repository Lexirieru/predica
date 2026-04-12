"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppKitAccount, useAppKit } from "@reown/appkit/react";
import { fetchUserVotes, fetchBalance } from "@/lib/api";
import DepositModal from "@/components/DepositModal";
import WithdrawModal from "@/components/WithdrawModal";

interface VoteEntry {
  id: string;
  market_id: string;
  side: string;
  amount: number;
  payout: number;
  status: string;
  created_at: number;
}

export default function ProfilePage() {
  const { address: wallet, isConnected: authenticated } = useAppKitAccount();
  const { open: openAppKit } = useAppKit();
  const [votes, setVotes] = useState<VoteEntry[]>([]);
  const [balance, setBalance] = useState(0);
  const [totalDeposits, setTotalDeposits] = useState(0);
  const [loading, setLoading] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const [votesData, balanceData] = await Promise.all([
        fetchUserVotes(wallet),
        fetchBalance(wallet),
      ]);
      setVotes(votesData);
      setBalance(balanceData.balance);
      setTotalDeposits(balanceData.totalDeposits);
    } catch {}
    setLoading(false);
  }, [wallet]);

  useEffect(() => { loadData(); }, [loadData]);

  const yesVotes = votes.filter((v) => v.side === "yes").length;
  const noVotes = votes.filter((v) => v.side === "no").length;
  const truncate = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  if (!authenticated) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-yes)] to-cyan-400 flex items-center justify-center mb-4 shadow-[0_0_24px_var(--color-yes-glow)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="#000" strokeWidth="2" />
            <path d="M20 21c0-3.314-3.582-6-8-6s-8 2.686-8 6" stroke="#000" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="text-white text-lg font-bold mb-1">Connect Wallet</h2>
        <p className="text-white/30 text-sm text-center mb-5">Connect to deposit USDP and start predicting</p>
        <button onClick={() => openAppKit()} className="px-6 py-3 rounded-2xl bg-gradient-to-r from-[var(--color-yes)] to-cyan-400 text-black font-semibold text-sm">
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Profile</h1>
          <p className="text-white/30 text-sm font-mono">{wallet ? truncate(wallet) : ""}</p>
        </div>
        <button onClick={() => openAppKit()} className="px-3 py-1.5 rounded-full bg-white/[0.05] text-white/40 text-xs border border-white/[0.08]">
          Wallet
        </button>
      </div>

      {/* Balance card — main CTA */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-[#00D1A9]/10 to-transparent border border-[#00D1A9]/15 mb-4">
        <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Predica Balance</p>
        <p className="text-white text-3xl font-bold tabular-nums mb-3">${balance.toFixed(2)} <span className="text-white/30 text-sm">USDP</span></p>
        <div className="flex gap-2">
          <button
            onClick={() => setDepositOpen(true)}
            className="flex-1 h-10 rounded-xl font-semibold text-sm active:scale-[0.97] transition-transform"
            style={{ backgroundColor: "#00b482", color: "#fff" }}
          >
            Deposit
          </button>
          <button
            onClick={() => setWithdrawOpen(true)}
            disabled={balance <= 0}
            className="flex-1 h-10 rounded-xl font-semibold text-sm bg-white/[0.06] text-white/70 border border-white/[0.1] disabled:opacity-30 active:scale-[0.97] transition-transform"
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
          <p className="text-white text-lg font-bold tabular-nums">{votes.length}</p>
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Votes</p>
        </div>
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
          <p className="text-[var(--color-yes)] text-lg font-bold tabular-nums">{yesVotes}</p>
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Up</p>
        </div>
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
          <p className="text-[var(--color-no)] text-lg font-bold tabular-nums">{noVotes}</p>
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Down</p>
        </div>
      </div>

      {/* Vote history */}
      <h2 className="text-white/50 text-xs uppercase tracking-wider mb-3">Recent Votes</h2>
      {loading ? (
        <div className="flex justify-center pt-10">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : votes.length === 0 ? (
        <div className="text-center pt-10 text-white/20">
          <p className="text-sm">No votes yet</p>
          <p className="text-xs mt-1">Deposit USDP and start predicting!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {votes.slice(0, 20).map((vote) => (
            <div key={vote.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{
                    backgroundColor: vote.side === "yes" ? "rgba(0,209,169,0.15)" : "rgba(255,73,118,0.15)",
                    color: vote.side === "yes" ? "var(--color-yes)" : "var(--color-no)",
                  }}
                >{vote.side === "yes" ? "U" : "D"}</div>
                <div>
                  <p className="text-white text-sm font-medium">${vote.amount.toFixed(2)}</p>
                  <p className="text-white/20 text-[10px]">{new Date(vote.created_at).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="text-right">
                {vote.status === "won" && <p className="text-[var(--color-yes)] text-sm font-semibold tabular-nums">+${(vote.payout - vote.amount).toFixed(2)}</p>}
                {vote.status === "lost" && <p className="text-[var(--color-no)] text-sm font-semibold tabular-nums">-${vote.amount.toFixed(2)}</p>}
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: vote.status === "won" ? "rgba(0,209,169,0.1)" : vote.status === "lost" ? "rgba(255,73,118,0.1)" : "rgba(255,255,255,0.05)",
                    color: vote.status === "won" ? "var(--color-yes)" : vote.status === "lost" ? "var(--color-no)" : "rgba(255,255,255,0.3)",
                  }}
                >{vote.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} onSuccess={loadData} />
      {wallet && <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} onSuccess={loadData} wallet={wallet} balance={balance} />}
    </div>
  );
}
