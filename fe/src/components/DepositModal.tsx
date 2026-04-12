"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import type { Provider } from "@reown/appkit-adapter-solana/react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { verifyDeposit } from "@/lib/api";

const USDP_MINT = new PublicKey("USDPqRbLidFGufty2s3oizmDEKdqx7ePTqzDMbf5ZKM");
const BACKEND_WALLET = new PublicKey("8SnuZxuTXWRfmHPypqCAq7tFeqboSkyAtrd9ng34VPBy");
const RPC_URL = "https://api.devnet.solana.com";
const QUICK_AMOUNTS = [10, 50, 100, 500];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DepositModal({ open, onClose, onSuccess }: Props) {
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Provider>("solana");
  const [amount, setAmount] = useState(0);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleDeposit = async () => {
    if (amount <= 0 || submitting || !isConnected || !address || !walletProvider) return;

    setSubmitting(true);
    setStatus("Building transaction...");

    try {
      const connection = new Connection(RPC_URL, "confirmed");
      const fromPubkey = new PublicKey(address);

      const fromAta = await getAssociatedTokenAddress(USDP_MINT, fromPubkey);
      const toAta = await getAssociatedTokenAddress(USDP_MINT, BACKEND_WALLET);

      const tx = new Transaction();

      // Create backend ATA if needed
      const toAtaInfo = await connection.getAccountInfo(toAta);
      if (!toAtaInfo) {
        tx.add(createAssociatedTokenAccountInstruction(fromPubkey, toAta, BACKEND_WALLET, USDP_MINT));
      }

      // SPL transfer (6 decimals)
      const amountLamports = BigInt(Math.round(amount * 1_000_000));
      tx.add(createTransferInstruction(fromAta, toAta, fromPubkey, amountLamports));

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = fromPubkey;

      // Sign & send via Reown wallet provider
      setStatus("Sign in your wallet...");
      const result = await walletProvider.signAndSendTransaction(tx);
      const txSig = String(result);

      setStatus("Confirming on-chain...");
      await connection.confirmTransaction(txSig, "confirmed");

      // Verify on backend
      setStatus("Verifying deposit...");
      await verifyDeposit(address, amount, txSig);

      setStatus("Deposit successful!");
      setTimeout(() => { onSuccess(); onClose(); setAmount(0); setStatus(""); }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      setStatus(msg);
      console.error("Deposit error:", err);
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
            className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-[70] rounded-t-[28px] border-t border-[#00D1A9]/15 overflow-hidden"
            style={{ background: "linear-gradient(180deg, #151515 0%, #111 100%)" }}
          >
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-white/15" /></div>
            <div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-white text-lg font-bold">Deposit USDP</h3>
                  <p className="text-white/25 text-xs">SPL transfer to Predica vault</p>
                </div>
                <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/[0.05] flex items-center justify-center text-white/40">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="text-center mb-4">
                <p className="text-white/30 text-xs mb-1">Amount</p>
                <p className="text-white text-4xl font-bold tabular-nums">${amount}</p>
                <p className="text-white/15 text-[10px] mt-1">USDP from your wallet → Predica</p>
              </div>

              <div className="flex gap-2 justify-center mb-4">
                {QUICK_AMOUNTS.map((val) => (
                  <button key={val} onClick={() => setAmount((p) => p + val)}
                    className="px-4 py-2 rounded-xl bg-white/[0.06] border border-white/[0.1] text-white/70 text-sm font-semibold hover:bg-white/[0.1] transition-colors"
                  >+${val}</button>
                ))}
                <button onClick={() => setAmount(0)} className="px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/30 text-xs">Clear</button>
              </div>

              {status && (
                <p className={`text-center text-xs mb-3 ${status.includes("fail") || status.includes("error") || status.includes("No ") ? "text-[var(--color-no)]" : status.includes("successful") ? "text-[var(--color-yes)]" : "text-white/40"}`}>
                  {status}
                </p>
              )}

              <button onClick={handleDeposit} disabled={amount <= 0 || submitting}
                className="w-full min-h-[52px] rounded-2xl font-bold text-base transition-all duration-150 disabled:opacity-30 active:scale-[0.97]"
                style={{ backgroundColor: "#00b482", color: "#fff" }}
              >
                {submitting ? status || "Processing..." : `Deposit $${amount} USDP`}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
