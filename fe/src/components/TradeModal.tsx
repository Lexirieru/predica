"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { useStore } from "@/store/useStore";
import { placeVote } from "@/lib/api";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import type { Provider } from "@reown/appkit-adapter-solana";
import { signAuthHeaders } from "@/lib/signAuth";
import { computeShareWeight } from "@/lib/payoutWeight";

const QUICK_AMOUNTS = [1, 5, 10, 100];
const SWIPE_THRESHOLD = 80;

export default function TradeModal() {
  // Selective selectors so the modal only re-renders when a state slice it
  // actually reads changes. Bare destructure subscribes to the entire store
  // and re-rendered on every unrelated change (toasts, markets, candles, ...).
  const tradeModalOpen = useStore((s) => s.tradeModalOpen);
  const tradeModalSide = useStore((s) => s.tradeModalSide);
  const tradeModalMarketId = useStore((s) => s.tradeModalMarketId);
  const markets = useStore((s) => s.markets);
  const balance = useStore((s) => s.balance);
  const pendingVotes = useStore((s) => s.pendingVotes);
  const closeTradeModal = useStore((s) => s.closeTradeModal);
  const applyOptimisticVote = useStore((s) => s.applyOptimisticVote);
  const confirmOptimisticVote = useStore((s) => s.confirmOptimisticVote);
  const rollbackOptimisticVote = useStore((s) => s.rollbackOptimisticVote);
  const pushToast = useStore((s) => s.pushToast);
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Provider>("solana");
  const [amount, setAmount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const dragStartTime = useRef<number>(0);

  const market = markets.find((m) => m.id === tradeModalMarketId);
  const isUp = tradeModalSide === "yes";
  const colorHex = isUp ? "#00D1A9" : "#FF4976";
  const label = isUp ? "Up" : "Down";

  // Live-preview the effective share weight for this bet. Re-ticks every
  // second so user can see the warning grow as time runs out. Pool-reading
  // from Zustand store keeps it in sync with WS NEW_VOTE events.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!tradeModalOpen) return;
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [tradeModalOpen]);
  void tick; // re-render trigger only

  const previewWeight = market && tradeModalSide
    ? computeShareWeight({
        targetPoolBefore: tradeModalSide === "yes" ? market.yesPool : market.noPool,
        oppositePoolBefore: tradeModalSide === "yes" ? market.noPool : market.yesPool,
        deadline: market.deadline,
        now: Date.now(),
        durationMin: market.durationMin,
      })
    : 1;

  const handleDragStart = () => { dragStartTime.current = Date.now(); };
  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const elapsed = Date.now() - dragStartTime.current;
    const velocity = Math.abs(info.offset.y) / elapsed;
    if (info.offset.y > SWIPE_THRESHOLD || (velocity > 0.11 && info.offset.y > 0)) closeTradeModal();
  };

  const handleConfirm = async () => {
    if (!isConnected || !address || !walletProvider) return;
    if (!market || !tradeModalSide || submitting || amount <= 0) return;

    if (amount > balance) {
      setStatus(`Insufficient balance ($${balance.toFixed(2)}). Deposit first.`);
      return;
    }

    // Double-submit guard: if there's already a pending vote for this market,
    // block. The previous POST is still in flight and its background reconcile
    // hasn't landed yet. Without this, rapid clicks would debit twice and fire
    // two POSTs — both of which succeed on the BE and charge the user double.
    if (pendingVotes.some((v) => v.marketId === market.id)) {
      setStatus("Vote already processing...");
      return;
    }

    setSubmitting(true);
    setStatus("Signing...");

    // Phase 1: sign via centralized helper (same message format used by
    // WithdrawModal and push subscribe — single source of truth in signAuth.ts).
    let signed;
    try {
      signed = await signAuthHeaders(walletProvider, "VOTE", address);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Signing cancelled");
      setSubmitting(false);
      return;
    }

    // Phase 2: optimistic commit. Debit balance + bump pool + close modal
    // IMMEDIATELY. User sees instant feedback. BE POST happens in background.
    const marketId = market.id;
    const side = tradeModalSide;
    const wager = amount;
    const tempId = applyOptimisticVote({ marketId, side, amount: wager, wallet: address });

    closeTradeModal();
    setAmount(0);
    setStatus("");
    setSubmitting(false);

    // Phase 3: background POST + reconcile.
    try {
      const result = await placeVote(marketId, address, side, wager, signed.headers["x-signature"], signed.timestamp);
      confirmOptimisticVote(tempId, result.balance ?? balance - wager);
      pushToast("success", `Vote placed: ${side === "yes" ? "Up" : "Down"} $${wager}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Vote failed";
      rollbackOptimisticVote(tempId, `Vote rolled back: ${reason}`);
    }
  };

  return (
    <AnimatePresence>
      {tradeModalOpen && market && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeTradeModal}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center pointer-events-none">
          <motion.div
            initial={{ transform: "translateY(100%) scale(0.95)", opacity: 0 }}
            animate={{ transform: "translateY(0%) scale(1)", opacity: 1 }}
            exit={{ transform: "translateY(100%) scale(0.98)", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            drag="y" dragConstraints={{ top: 0 }} dragElastic={0.2}
            onDragStart={handleDragStart} onDragEnd={handleDragEnd}
            className="w-full max-w-[430px] md:max-w-[480px] rounded-t-[28px] md:rounded-2xl border-t md:border overflow-hidden pointer-events-auto"
            style={{ background: "linear-gradient(180deg, #151515 0%, #111 100%)", borderColor: `${colorHex}15` }}
            role="dialog" aria-modal="true"
          >
            <div className="flex justify-center pt-3 pb-1 md:hidden">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>
            <div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:p-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-white text-lg font-bold">Buy <span style={{ color: colorHex }}>{label}</span></h3>
                  <p className="text-white/25 text-xs">{market.symbol} · Internal Balance</p>
                </div>
                <button onClick={closeTradeModal} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/40">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="text-center mb-1 py-2 rounded-xl bg-white/3 border border-white/6">
                <p className="text-white/25 text-[10px] uppercase tracking-wider">Your Balance</p>
                <p className="text-white text-lg font-bold tabular-nums">${balance.toFixed(2)} <span className="text-white/30 text-xs">USDP</span></p>
              </div>

              <div className="text-center mb-3 mt-3">
                <p className="text-white/30 text-xs mb-1">Wager</p>
                <div className="flex items-center justify-center gap-1">
                  <span className="text-white text-4xl font-bold">$</span>
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
                    className="bg-transparent text-white text-4xl font-bold tabular-nums text-center outline-none border-b border-transparent focus:border-white/15 transition-colors w-32 placeholder:text-white/20"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-center mb-3">
                {QUICK_AMOUNTS.map((val) => (
                  <button key={val} onClick={() => setAmount((p) => p + val)}
                    className="px-4 py-2 rounded-xl bg-white/6 border border-white/1 text-white/70 text-sm font-semibold hover:bg-white/1 transition-colors"
                  >+${val}</button>
                ))}
                <button onClick={() => setAmount(0)} className="px-3 py-2 rounded-xl bg-white/4 border border-white/8 text-white/30 text-xs">Clear</button>
              </div>

              {/* Polymarket-style "To win" payout preview. Pool-based payout:
                  user's effective stake / (winning side pool + effective stake)
                  × total prize pool (yesPool + noPool + user's bet).
                  Weight < 1 lowers effective stake for late bets, matching BE
                  settlement math. */}
              {amount > 0 && market && (() => {
                const sidePool = tradeModalSide === "yes" ? market.yesPool : market.noPool;
                const effectiveStake = amount * previewWeight;
                const totalPrizePool = market.yesPool + market.noPool + amount;
                const userShare = effectiveStake / (sidePool + effectiveStake);
                const payout = userShare * totalPrizePool;
                const profit = payout - amount;
                return (
                  <div className="mb-3 px-4 py-3 rounded-xl bg-white/3 border border-white/6 flex items-center justify-between">
                    <div>
                      <p className="text-white/60 text-xs font-semibold flex items-center gap-1">
                        To win <span>💵</span>
                      </p>
                      {previewWeight < 1 && (
                        <p className="text-white/30 text-[10px] mt-0.5">
                          Late bet · {Math.round(previewWeight * 100)}% effective stake
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[var(--color-yes)] text-2xl font-bold tabular-nums">
                        ${payout.toFixed(2)}
                      </p>
                      {profit > 0 && (
                        <p className="text-white/40 text-[10px] tabular-nums">
                          +${profit.toFixed(2)} profit
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {status && (
                <p className={`text-center text-xs mb-3 ${status.includes("nsufficient") || status.includes("ail") ? "text-(--color-no)" : status.includes("placed") ? "text-(--color-yes)" : "text-white/40"}`}>
                  {status}
                </p>
              )}

              <button
                onClick={handleConfirm}
                disabled={(amount <= 0 && isConnected) || submitting}
                className="w-full min-h-[52px] rounded-2xl font-bold text-base transition-all duration-150 disabled:opacity-30"
                style={{ background: `linear-gradient(135deg, ${colorHex}25 0%, ${colorHex}10 100%)`, color: colorHex, border: `1px solid ${colorHex}35` }}
              >
                {!isConnected ? "Connect Wallet" : submitting ? status || "..." : `Buy ${label} — $${amount}`}
              </button>
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
