"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import type { Provider } from "@reown/appkit-adapter-solana";
import type { PredictionMarket, Candle } from "@/lib/types";
import { useStore } from "@/store/useStore";
import { useNow } from "@/hooks/useNow";
import { useCandlesFor } from "@/hooks/useCandlesFor";
import { computeShareWeight } from "@/lib/payoutWeight";
import { placeVote, fetchCandleSeries } from "@/lib/api";
import { signAuthHeaders } from "@/lib/signAuth";
import SentimentBar from "./SentimentBar";
import SymbolTimeline from "./SymbolTimeline";
import TokenIcon from "./TokenIcon";

// Same Turbopack workaround as MarketCard — see comment there.
const PriceChart = dynamic(() => import("./PriceChart"), { ssr: false });

/**
 * Polymarket-style desktop layout for the feed page. 2-column grid:
 *  - Left:  market header, price summary, large chart, timeline pills.
 *  - Right: always-visible trade panel + related markets list.
 *
 * Mobile keeps the TikTok SwipeStack — this component is only mounted on
 * viewports ≥ md (see fe/src/app/page.tsx). Reuses the same data hooks
 * (useMarkets, useCandlesFor, etc.) so there's no second source of truth.
 */
function fmt(price: number): string {
  const abs = Math.abs(price);
  let precision: number;
  if (abs <= 0) precision = 2;
  else if (abs >= 1) precision = Math.max(0, 5 - (Math.floor(Math.log10(abs)) + 1));
  else precision = Math.floor(-Math.log10(abs)) + 5;
  return price.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

const QUICK_AMOUNTS = [1, 5, 10, 100];

interface Props {
  markets: PredictionMarket[];
  /** Same advance-all-settled callback as SwipeStack receives. */
  onAdvance?: () => void;
}

export default function DesktopFeed({ markets, onAdvance }: Props) {
  const currentMarketIndex = useStore((s) => s.currentMarketIndex);
  const setCurrentMarketIndex = useStore((s) => s.setCurrentMarketIndex);

  if (markets.length === 0) return null;
  const safeIndex = currentMarketIndex < markets.length ? currentMarketIndex : 0;
  const market = markets[safeIndex];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 grid grid-cols-[1fr_400px] gap-6 items-start">
        <DesktopMarketDetail market={market} onAdvance={onAdvance} />
        <div className="space-y-4 sticky top-20">
          <DesktopTradePanel market={market} onAdvance={onAdvance} />
          <DesktopRelatedMarkets
            markets={markets}
            currentIndex={safeIndex}
            onSelect={setCurrentMarketIndex}
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Market detail (left) ─────────────────────────── */

function DesktopMarketDetail({
  market,
  onAdvance,
}: {
  market: PredictionMarket;
  onAdvance?: () => void;
}) {
  const [cd, setCd] = useState({ m: 0, s: 0 });
  const [selectedBucket, setSelectedBucket] = useState<PredictionMarket | null>(null);
  const [historical, setHistorical] = useState<{ id: string; candles: Candle[] } | null>(null);

  // Reset selection when symbol changes (user clicks a different market in the
  // sidebar list).
  useEffect(() => {
    setSelectedBucket(null);
    setHistorical(null);
  }, [market.symbol]);

  // Fetch historical candles when a past bucket is selected (mirror of mobile
  // MarketCard's logic, slightly simplified — same 6h window).
  useEffect(() => {
    if (!selectedBucket) return;
    let cancelled = false;
    const bucketMs = selectedBucket.durationMin * 60_000;
    const start = selectedBucket.deadline - bucketMs - 3 * 60 * 1000;
    const end = selectedBucket.deadline + 60_000;
    fetchCandleSeries(selectedBucket.symbol, "6h")
      .then((all) => {
        if (cancelled) return;
        const sliced = all.filter((c) => {
          const ms = c.time * 1000;
          return ms >= start && ms <= end;
        });
        setHistorical({
          id: selectedBucket.id,
          candles: sliced.length >= 2 ? sliced : all.slice(-30),
        });
      })
      .catch(() => {
        if (!cancelled) setHistorical({ id: selectedBucket.id, candles: [] });
      });
    return () => { cancelled = true; };
  }, [selectedBucket]);

  useEffect(() => {
    const windowMs = market.durationMin * 60_000;
    const tick = () => {
      const d = Math.max(0, market.deadline - Date.now());
      const capped = Math.min(d, windowMs);
      setCd({
        m: Math.floor(capped / 60000),
        s: Math.floor((capped % 60000) / 1000),
      });
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [market.deadline, market.durationMin]);

  const { candles: liveCandles } = useCandlesFor(market.symbol);
  const displayMarket = selectedBucket ?? market;
  const historicalCandles =
    selectedBucket && historical?.id === selectedBucket.id ? historical.candles : null;
  const displayCandles = historicalCandles ?? liveCandles;
  const diff = displayMarket.currentPrice - displayMarket.targetPrice;
  const isUp = diff >= 0;
  const now = useNow(1_000);
  const expired = market.deadline <= now;
  const resolved = market.status === "resolved" || market.status === "settled";
  const frozen = !!selectedBucket || resolved;
  const settledPositive =
    selectedBucket?.resolution === "yes" || market.resolution === "yes";

  return (
    <div className="rounded-2xl bg-[#141414] border border-white/6 overflow-hidden flex flex-col">
      {/* Header row */}
      <div className="px-6 pt-6 pb-2 flex items-center gap-4">
        <TokenIcon symbol={market.symbol} size={56} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-white text-2xl font-bold">
              {market.symbol} Up or Down — {market.durationMin} Minutes
            </h1>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                market.durationMin === 15
                  ? "bg-[#00b482]/15 text-[#00b482]"
                  : "bg-white/10 text-white/60"
              }`}
            >
              {market.durationMin}m
            </span>
            {market.totalVoters > 0 && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-400">
                Hot
              </span>
            )}
          </div>
          <p className="text-white/30 text-xs">
            {new Date(market.deadline - market.durationMin * 60_000).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: "UTC",
            })}–
            {new Date(market.deadline).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: "UTC",
            })} UTC
          </p>
        </div>
        <div className="text-right">
          <div
            className={`tabular-nums font-bold text-3xl ${
              expired ? "text-white/15" : cd.m === 0 && cd.s < 30 ? "text-[#dc3246]" : "text-white"
            }`}
          >
            {String(cd.m).padStart(2, "0")}
            <span className="text-white/20">:</span>
            {String(cd.s).padStart(2, "0")}
          </div>
          <p className="text-[10px] text-white/30 uppercase tracking-widest">Min · Sec</p>
        </div>
      </div>

      <SentimentBar symbol={market.symbol} fallback={market.sentiment} />

      {/* Price summary */}
      <div className="px-6 pb-3 flex justify-between items-end">
        <div>
          <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Price To Beat</p>
          <p className="text-white/60 text-2xl font-bold tabular-nums">
            ${fmt(market.targetPrice)}
          </p>
        </div>
        <div className="text-right">
          <p
            className={`text-[10px] uppercase tracking-widest mb-1 ${
              isUp ? "text-[#00b482]" : "text-[#dc3246]"
            }`}
          >
            Current {isUp ? "▲" : "▼"} ${fmt(Math.abs(diff))}
          </p>
          <p
            className={`text-2xl font-bold tabular-nums ${
              isUp ? "text-[#00b482]" : "text-[#dc3246]"
            }`}
          >
            ${fmt(market.currentPrice)}
          </p>
        </div>
      </div>

      {/* Chart — taller on desktop than mobile MarketCard's flex-1 chart */}
      <div className="mx-6 mb-3 rounded-xl bg-[#0d0d0d] border border-white/6 p-4 h-[420px] overflow-hidden relative">
        <PriceChart
          key={selectedBucket ? `frozen-${selectedBucket.id}` : `live-${market.symbol}`}
          candles={displayCandles}
          currentPrice={displayMarket.currentPrice}
          isPositive={isUp}
          targetPrice={displayMarket.targetPrice}
          frozen={frozen}
          settlementPrice={
            frozen ? selectedBucket?.currentPrice ?? market.currentPrice : undefined
          }
          settledPositive={settledPositive}
        />
        {frozen && selectedBucket && (
          <div className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-md bg-black/60 border border-white/10 backdrop-blur-sm">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Viewing past round</p>
            <p
              className={`text-xs font-bold ${
                settledPositive ? "text-[#00b482]" : "text-[#dc3246]"
              }`}
            >
              {settledPositive ? "▲ UP" : "▼ DOWN"} · settled $
              {selectedBucket.currentPrice.toFixed(selectedBucket.currentPrice >= 1 ? 2 : 6)}
            </p>
          </div>
        )}
      </div>

      <SymbolTimeline
        symbol={market.symbol}
        durationMin={market.durationMin}
        currentLive={market.status === "active" ? market : null}
        pastLimit={5}
        upcomingLimit={4}
        selectedBucketId={selectedBucket?.id}
        onBucketClick={(bucket) => setSelectedBucket(bucket)}
      />

      {/* Pool stats footer */}
      <div className="px-6 py-3 flex justify-between text-xs text-white/30 tabular-nums border-t border-white/4">
        <span>
          Pool $
          {market.yesPool + market.noPool >= 1000
            ? `${((market.yesPool + market.noPool) / 1000).toFixed(1)}K`
            : (market.yesPool + market.noPool).toFixed(0)}
        </span>
        <span>{market.totalVoters} voters</span>
        <span>Via Pacifica</span>
      </div>

      {/* Settled banner */}
      {resolved && !selectedBucket && (
        <div className="px-6 pb-5 pt-3 border-t border-white/4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-white/40">Final</span>
            <span
              className={`text-base font-bold ${
                market.resolution === "yes" ? "text-[#00b482]" : "text-[#dc3246]"
              }`}
            >
              {market.resolution === "yes" ? "▲ UP" : "▼ DOWN"}
            </span>
          </div>
          <button
            onClick={() => onAdvance?.()}
            className="px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 bg-white/8 border border-white/10 text-white hover:bg-white/12 transition-colors"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#dc3246] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#dc3246]" />
            </span>
            Go to live market →
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Trade panel (right) ─────────────────────────── */

function DesktopTradePanel({
  market,
  onAdvance,
}: {
  market: PredictionMarket;
  onAdvance?: () => void;
}) {
  const balance = useStore((s) => s.balance);
  const pendingVotes = useStore((s) => s.pendingVotes);
  const applyOptimisticVote = useStore((s) => s.applyOptimisticVote);
  const confirmOptimisticVote = useStore((s) => s.confirmOptimisticVote);
  const rollbackOptimisticVote = useStore((s) => s.rollbackOptimisticVote);
  const pushToast = useStore((s) => s.pushToast);
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Provider>("solana");

  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  const now = useNow(1_000);
  const expired = market.deadline <= now;
  const resolved = market.status === "resolved" || market.status === "settled";
  const disabled = expired || resolved;

  // Reset selected side back to Up when switching markets.
  useEffect(() => {
    setAmount(0);
    setSide("yes");
    setStatus("");
  }, [market.id]);

  // Live preview the share weight (anti-sniper curve). Re-tick every second.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);
  void tick;

  const total = market.yesPool + market.noPool;
  const upOdds =
    total > 0 ? Math.max(1, Math.round((market.yesPool / total) * 100)) : 50;
  const downOdds = 100 - upOdds;
  const colorHex = side === "yes" ? "#00D1A9" : "#FF4976";
  const label = side === "yes" ? "Up" : "Down";

  const previewWeight = computeShareWeight({
    targetPoolBefore: side === "yes" ? market.yesPool : market.noPool,
    oppositePoolBefore: side === "yes" ? market.noPool : market.yesPool,
    deadline: market.deadline,
    now: Date.now(),
    durationMin: market.durationMin,
  });

  const handleConfirm = async () => {
    if (!isConnected || !address || !walletProvider) {
      setStatus("Connect wallet first");
      return;
    }
    if (disabled || submitting || amount <= 0) return;
    if (amount > balance) {
      setStatus(`Insufficient balance ($${balance.toFixed(2)}). Deposit first.`);
      return;
    }
    if (pendingVotes.some((v) => v.marketId === market.id)) {
      setStatus("Vote already processing...");
      return;
    }

    setSubmitting(true);
    setStatus("Signing...");
    let signed;
    try {
      signed = await signAuthHeaders(walletProvider, "VOTE", address);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Signing cancelled");
      setSubmitting(false);
      return;
    }
    const wager = amount;
    const tempId = applyOptimisticVote({
      marketId: market.id,
      side,
      amount: wager,
      wallet: address,
    });
    setAmount(0);
    setStatus("");
    setSubmitting(false);

    try {
      const result = await placeVote(
        market.id,
        address,
        side,
        wager,
        signed.headers["x-signature"],
        signed.timestamp,
      );
      confirmOptimisticVote(tempId, result.balance ?? balance - wager);
      pushToast("success", `Vote placed: ${side === "yes" ? "Up" : "Down"} $${wager}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Vote failed";
      rollbackOptimisticVote(tempId, `Vote rolled back: ${reason}`);
    }
  };

  // Settled market: show "Go to live" CTA in place of trade panel.
  if (resolved) {
    return (
      <div className="rounded-2xl bg-[#141414] border border-white/6 p-6 text-center">
        <p className="text-xs uppercase tracking-widest text-white/40 mb-2">Final</p>
        <p
          className={`text-2xl font-bold mb-4 ${
            market.resolution === "yes" ? "text-[#00b482]" : "text-[#dc3246]"
          }`}
        >
          {market.resolution === "yes" ? "▲ UP" : "▼ DOWN"}
        </p>
        <button
          onClick={() => onAdvance?.()}
          className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-white/8 border border-white/10 text-white hover:bg-white/12 transition-colors"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#dc3246] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#dc3246]" />
          </span>
          Go to live market →
        </button>
      </div>
    );
  }

  // Polymarket-style "To Win" preview.
  let payoutBlock: { payout: number; profit: number; weight: number } | null = null;
  if (amount > 0) {
    const sidePool = side === "yes" ? market.yesPool : market.noPool;
    const effectiveStake = amount * previewWeight;
    const totalPrizePool = market.yesPool + market.noPool + amount;
    const userShare = effectiveStake / (sidePool + effectiveStake);
    const payout = userShare * totalPrizePool;
    payoutBlock = { payout, profit: payout - amount, weight: previewWeight };
  }

  return (
    <div className="rounded-2xl bg-[#141414] border border-white/6 p-5">
      {/* Buy/Sell row — only Buy is active for Predica */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/6">
        <div className="flex gap-4">
          <button className="text-white text-base font-bold relative pb-1">
            Buy
            <span className="absolute -bottom-[13px] left-0 right-0 h-0.5 bg-white" />
          </button>
          <button className="text-white/30 text-base font-medium pb-1 cursor-not-allowed" disabled>
            Sell
          </button>
        </div>
        <span className="text-white/30 text-xs">Market</span>
      </div>

      {/* Up/Down toggle — pill buttons */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide("yes")}
          disabled={disabled}
          className={`h-12 rounded-xl font-bold text-sm transition-all ${
            side === "yes"
              ? "bg-[#00b482] text-white"
              : "bg-white/4 text-white/60 hover:bg-white/8"
          } disabled:opacity-30`}
        >
          Up {upOdds}¢
        </button>
        <button
          onClick={() => setSide("no")}
          disabled={disabled}
          className={`h-12 rounded-xl font-bold text-sm transition-all ${
            side === "no"
              ? "bg-[#dc3246] text-white"
              : "bg-white/4 text-white/60 hover:bg-white/8"
          } disabled:opacity-30`}
        >
          Down {downOdds}¢
        </button>
      </div>

      {/* Amount input */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-white/40 text-xs">Amount</p>
          <p className="text-white/30 text-[11px]">Balance ${balance.toFixed(2)}</p>
        </div>
        <div className="flex items-center gap-1 px-4 py-3 rounded-xl bg-white/4 border border-white/6 focus-within:border-white/15 transition-colors">
          <span className="text-white text-2xl font-bold">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount === 0 ? "" : amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              const n = parseFloat(v);
              setAmount(isNaN(n) ? 0 : n);
            }}
            placeholder="0"
            className="bg-transparent text-white text-2xl font-bold tabular-nums text-right outline-none flex-1 placeholder:text-white/15"
          />
        </div>
      </div>

      {/* Quick amounts */}
      <div className="flex gap-1.5 mb-4">
        {QUICK_AMOUNTS.map((val) => (
          <button
            key={val}
            onClick={() => setAmount((p) => p + val)}
            className="flex-1 py-2 rounded-lg bg-white/4 border border-white/6 text-white/70 text-xs font-semibold hover:bg-white/8 transition-colors"
          >
            +${val}
          </button>
        ))}
        <button
          onClick={() => setAmount(balance)}
          className="flex-1 py-2 rounded-lg bg-white/4 border border-white/6 text-white/70 text-xs font-semibold hover:bg-white/8 transition-colors"
        >
          Max
        </button>
      </div>

      {/* To Win */}
      {payoutBlock && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-white/3 border border-white/6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/60 text-xs font-semibold flex items-center gap-1">
                To win <span>💵</span>
              </p>
              {payoutBlock.weight < 1 && (
                <p className="text-white/30 text-[10px] mt-0.5">
                  Late bet · {Math.round(payoutBlock.weight * 100)}% effective stake
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[#00b482] text-2xl font-bold tabular-nums">
                ${payoutBlock.payout.toFixed(2)}
              </p>
              {payoutBlock.profit > 0 && (
                <p className="text-white/40 text-[10px] tabular-nums">
                  +${payoutBlock.profit.toFixed(2)} profit
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {status && (
        <p
          className={`text-center text-xs mb-3 ${
            status.includes("nsufficient") || status.includes("ail") || status.includes("Connect")
              ? "text-[#dc3246]"
              : "text-white/40"
          }`}
        >
          {status}
        </p>
      )}

      {/* Big CTA */}
      <button
        onClick={handleConfirm}
        disabled={disabled || submitting || (amount <= 0 && isConnected)}
        className="w-full min-h-[52px] rounded-xl font-bold text-base transition-all duration-150 disabled:opacity-30"
        style={{
          background: `linear-gradient(135deg, ${colorHex}25 0%, ${colorHex}10 100%)`,
          color: colorHex,
          border: `1px solid ${colorHex}35`,
        }}
      >
        {!isConnected
          ? "Connect Wallet"
          : submitting
            ? status || "..."
            : `Buy ${label}${amount > 0 ? ` — $${amount}` : ""}`}
      </button>

      <p className="text-center text-white/20 text-[10px] mt-3">
        Settles via Pacifica mark price
      </p>
    </div>
  );
}

/* ─────────────────────────── Related markets list ─────────────────────────── */

function DesktopRelatedMarkets({
  markets,
  currentIndex,
  onSelect,
}: {
  markets: PredictionMarket[];
  currentIndex: number;
  onSelect: (idx: number) => void;
}) {
  if (markets.length <= 1) return null;
  // Show top 6 OTHER markets, sorted by total pool desc (more activity first).
  const others = markets
    .map((m, i) => ({ market: m, index: i }))
    .filter((x) => x.index !== currentIndex)
    .sort((a, b) => b.market.yesPool + b.market.noPool - (a.market.yesPool + a.market.noPool))
    .slice(0, 6);

  return (
    <div className="rounded-2xl bg-[#141414] border border-white/6 p-4">
      <p className="text-white/40 text-[10px] uppercase tracking-widest mb-3 px-1">
        More markets
      </p>
      <div className="space-y-1">
        {others.map(({ market: m, index }) => {
          const t = m.yesPool + m.noPool;
          const upPct = t > 0 ? Math.round((m.yesPool / t) * 100) : 50;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(index)}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/4 transition-colors text-left"
            >
              <TokenIcon symbol={m.symbol} size={28} />
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold truncate">
                  {m.symbol}{" "}
                  <span className="text-white/40 font-normal">· {m.durationMin}m</span>
                </p>
                <p className="text-white/30 text-[10px]">
                  Pool ${t >= 1000 ? `${(t / 1000).toFixed(1)}K` : t.toFixed(0)}
                </p>
              </div>
              <span
                className={`text-xs font-bold tabular-nums ${
                  upPct >= 50 ? "text-[#00b482]" : "text-[#dc3246]"
                }`}
              >
                {upPct}%
                <span className="text-white/30 font-normal ml-0.5 text-[10px]">
                  {upPct >= 50 ? "Up" : "Down"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
