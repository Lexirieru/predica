"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppKitProvider } from "@reown/appkit/react";
import type { Provider } from "@reown/appkit-adapter-solana";
import { requestWithdraw } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { signAuthHeaders } from "@/lib/signAuth";

const QUICK_AMOUNTS = [10, 50, 100, 500];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  wallet: string;
  balance: number;
}

export default function WithdrawModal({ open, onClose, onSuccess, wallet, balance }: Props) {
  const [amount, setAmount] = useState(0);
  const [status, setStatus] = useState("");
  const [txLink, setTxLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const setStoreBalance = useStore((s) => s.setBalance);
  const { walletProvider } = useAppKitProvider<Provider>("solana");

  const handleWithdraw = async () => {
    if (amount <= 0 || amount > balance || submitting) return;
    if (!walletProvider) {
      setStatus("Wallet not connected");
      return;
    }

    setSubmitting(true);
    setStatus("Sign to authorize withdrawal...");

    // 1. Sign the auth message so BE authMiddleware accepts the request.
    //    Without this the server rejects with 401 — that was the silent
    //    failure before this fix.
    let signed;
    try {
      signed = await signAuthHeaders(walletProvider, "WITHDRAW", wallet);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Sign cancelled");
      setSubmitting(false);
      return;
    }

    setStatus("Sending USDP to your wallet...");

    try {
      const result = await requestWithdraw(wallet, amount, signed.headers["x-signature"], signed.timestamp);
      setStoreBalance(result.balance);
      const sig = result.txSignature;
      setTxLink(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
      setStatus("Withdrawn!");
      setTimeout(() => { onSuccess(); onClose(); setAmount(0); setStatus(""); setTxLink(""); }, 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ transform: "translateY(100%) scale(0.95)", opacity: 0 }}
            animate={{ transform: "translateY(0%) scale(1)", opacity: 1 }}
            exit={{ transform: "translateY(100%) scale(0.98)", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-[70] rounded-t-[28px] border-t border-white/8 overflow-hidden"
            style={{ background: "linear-gradient(180deg, #151515 0%, #111 100%)" }}
          >
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-white/15" /></div>
            <div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-white text-lg font-bold">Withdraw USDP</h3>
                  <p className="text-white/25 text-xs">Send to your Solana wallet</p>
                </div>
                <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/40">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="text-center mb-1 py-2 rounded-xl bg-white/3 border border-white/6">
                <p className="text-white/25 text-[10px] uppercase tracking-wider">Available</p>
                <p className="text-white text-lg font-bold tabular-nums">${balance.toFixed(2)} <span className="text-white/30 text-xs">USDP</span></p>
              </div>

              <div className="text-center mb-3 mt-3">
                <p className="text-white/30 text-xs mb-1">Withdraw Amount</p>
                <div className="flex items-center justify-center gap-1">
                  <span className="text-white text-4xl font-bold">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount === 0 ? "" : amount}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, "");
                      const n = parseFloat(v);
                      setAmount(isNaN(n) ? 0 : Math.min(n, balance));
                    }}
                    placeholder="0"
                    className="bg-transparent text-white text-4xl font-bold tabular-nums text-center outline-none border-b border-transparent focus:border-white/15 transition-colors w-32 placeholder:text-white/20"
                  />
                </div>
                {amount > balance && (
                  <p className="text-(--color-no) text-[10px] mt-1">Exceeds your balance</p>
                )}
              </div>

              <div className="flex gap-2 justify-center mb-4">
                {QUICK_AMOUNTS.map((val) => (
                  <button key={val} onClick={() => setAmount((p) => Math.min(p + val, balance))}
                    className="px-4 py-2 rounded-xl bg-white/6 border border-white/1 text-white/70 text-sm font-semibold hover:bg-white/1 transition-colors"
                  >+${val}</button>
                ))}
                <button onClick={() => setAmount(Math.floor(balance))}
                  className="px-3 py-2 rounded-xl bg-white/4 border border-white/8 text-white/30 text-xs"
                >Max</button>
              </div>

              {status && (
                <p className={`text-center text-xs mb-2 ${status.includes("ail") ? "text-(--color-no)" : status.includes("ithdrawn") ? "text-(--color-yes)" : "text-white/40"}`}>
                  {status}
                </p>
              )}
              {txLink && (
                <a href={txLink} target="_blank" rel="noopener noreferrer"
                  className="block text-center text-[10px] text-(--color-yes) underline mb-3">
                  View on Solana Explorer →
                </a>
              )}

              <button onClick={handleWithdraw} disabled={amount <= 0 || amount > balance || submitting}
                className="w-full min-h-[52px] rounded-2xl font-bold text-base transition-all duration-150 disabled:opacity-30 active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {submitting ? status || "Processing..." : `Withdraw $${amount} USDP`}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
