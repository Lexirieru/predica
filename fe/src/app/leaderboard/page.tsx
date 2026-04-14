"use client";

import { useEffect, useState } from "react";
import { fetchLeaderboard } from "@/lib/api";

interface LeaderEntry {
  wallet: string;
  totalVotes: number;
  wins: number;
  losses: number;
  totalWagered: number;
  totalPnl: number;
}

export default function LeaderboardPage() {
  const [board, setBoard] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard()
      .then((data: LeaderEntry[]) => {
        setBoard([...data].sort((a, b) => (b.totalPnl ?? 0) - (a.totalPnl ?? 0)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const truncate = (addr: string) => `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <h1 className="text-xl font-bold text-white mb-1">Leaderboard</h1>
      <p className="text-white/30 text-sm mb-5">Top predictors by profit</p>

      {loading ? (
        <div className="flex justify-center pt-20">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : board.length === 0 ? (
        <div className="flex flex-col items-center justify-center pt-20 text-white/30">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="mb-3 text-white/10">
            <path d="M8 21V11M16 21V7M12 21V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p className="text-sm">No predictions yet</p>
          <p className="text-xs mt-1 text-white/20">Be the first to vote!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {board.map((entry, i) => {
            const rank = i + 1;
            const accuracy = entry.totalVotes > 0
              ? Math.round((entry.wins / entry.totalVotes) * 100)
              : 0;

            return (
              <div
                key={entry.wallet}
                className="flex items-center gap-3 p-3 rounded-2xl border border-white/[0.06] bg-white/[0.02]"
              >
                {/* Rank */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{
                    background: rank === 1
                      ? "linear-gradient(135deg, #FFD700, #FFA500)"
                      : rank === 2
                        ? "linear-gradient(135deg, #C0C0C0, #A0A0A0)"
                        : rank === 3
                          ? "linear-gradient(135deg, #CD7F32, #A0522D)"
                          : "rgba(255,255,255,0.05)",
                    color: rank <= 3 ? "#000" : "rgba(255,255,255,0.4)",
                  }}
                >
                  {rank}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold truncate">
                    {truncate(entry.wallet)}
                  </p>
                  <p className="text-white/30 text-xs">
                    {entry.wins}W {entry.losses}L · {accuracy}% accuracy
                  </p>
                </div>

                {/* PnL */}
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold tabular-nums ${(entry.totalPnl ?? 0) >= 0 ? "text-[#00b482]" : "text-[#dc3246]"}`}>
                    {(entry.totalPnl ?? 0) >= 0 ? "+" : ""}{(entry.totalPnl ?? 0).toFixed(2)} USDP
                  </p>
                  <p className="text-white/30 text-xs tabular-nums">
                    {entry.totalVotes} votes
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
