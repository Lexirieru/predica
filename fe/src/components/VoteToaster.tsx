"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore, type Toast } from "@/store/useStore";

const AUTO_DISMISS_MS = 3500;

export default function VoteToaster() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  // Auto-dismiss each toast after a timeout. Effect re-runs on toasts change,
  // but the timers target specific ids so duplicates are safe — a toast just
  // gets two dismiss calls (2nd is a no-op).
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [toasts, dismiss]);

  return (
    <div
      className="fixed bottom-20 left-0 right-0 z-[90] flex flex-col items-center gap-2 px-4 pointer-events-none"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastPill key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastPill({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const color =
    toast.kind === "success"
      ? "#00b482"
      : toast.kind === "error"
        ? "#dc3246"
        : "#e3b341";

  return (
    <motion.button
      initial={{ y: 40, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 20, opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      onClick={onDismiss}
      className="pointer-events-auto max-w-[380px] w-full px-4 py-2.5 rounded-xl border backdrop-blur-md bg-black/70 flex items-center gap-3 text-left"
      style={{ borderColor: `${color}55` }}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-white text-[13px] flex-1 leading-tight">{toast.text}</span>
    </motion.button>
  );
}
