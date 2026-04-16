"use client";

import type { PortfolioStats } from "@/lib/api";

interface Props {
  stats: PortfolioStats | null;
  loading: boolean;
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatCurrency(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export default function PortfolioStatsCard({ stats, loading }: Props) {
  if (loading) {
    return (
      <div className="p-4 rounded-2xl bg-white/2 border border-white/6 mb-4 animate-pulse">
        <div className="h-4 w-24 bg-white/6 rounded mb-2" />
        <div className="h-8 w-32 bg-white/6 rounded" />
      </div>
    );
  }
  if (!stats) return null;

  const pnlPositive = stats.totalPnl >= 0;
  const roiPositive = stats.roi >= 0;
  const settled = stats.wins + stats.losses;

  return (
    <div className="p-4 rounded-2xl bg-white/2 border border-white/6 mb-4">
      {/* PnL headline */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">All-time PnL</p>
          <p className={`text-2xl font-bold tabular-nums ${pnlPositive ? "text-[#00b482]" : "text-[#dc3246]"}`}>
            {pnlPositive ? "+" : ""}{formatCurrency(stats.totalPnl)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">ROI</p>
          <p className={`text-lg font-bold tabular-nums ${roiPositive ? "text-[#00b482]" : "text-[#dc3246]"}`}>
            {roiPositive ? "+" : ""}{formatPct(stats.roi)}
          </p>
        </div>
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <Stat label="Win rate" value={settled > 0 ? formatPct(stats.winRate) : "—"} />
        <Stat label="Avg bet" value={stats.avgBet > 0 ? formatCurrency(stats.avgBet) : "—"} />
        <Stat label="Volume" value={formatCurrency(stats.totalWagered)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Biggest win"
          value={stats.biggestWin > 0 ? `+${formatCurrency(stats.biggestWin)}` : "—"}
          color={stats.biggestWin > 0 ? "#00b482" : undefined}
        />
        <Stat
          label="Biggest loss"
          value={stats.biggestLoss > 0 ? `-${formatCurrency(stats.biggestLoss)}` : "—"}
          color={stats.biggestLoss > 0 ? "#dc3246" : undefined}
        />
      </div>

      {/* Win/Loss/Pending bar */}
      {stats.totalVotes > 0 && (
        <div className="mt-3 pt-3 border-t border-white/4">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-[#00b482]">● {stats.wins} won</span>
            <span className="text-[#dc3246]">● {stats.losses} lost</span>
            {stats.pending > 0 && <span className="text-white/40">● {stats.pending} pending</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-2.5 rounded-xl bg-white/2 border border-white/4">
      <p className="text-white/30 text-[9px] uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </p>
    </div>
  );
}
