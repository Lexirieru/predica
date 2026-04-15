"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";

/**
 * Subtle top-of-screen banner that appears only when the socket is NOT open.
 * Deliberately debounced: brief flickers during reconnect shouldn't yank the
 * user's attention, so we only show after 2s of sustained disconnection.
 */
export default function ConnectionBanner() {
  const status = useConnectionStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status === "open") {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed top-0 left-0 right-0 z-[80] flex justify-center pt-[env(safe-area-inset-top)] pointer-events-none"
        >
          <div className="mt-2 px-3 py-1.5 rounded-full bg-black/70 border border-white/10 backdrop-blur-md flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#dc3246] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#dc3246]" />
            </span>
            <span className="text-white/70 text-[11px] font-medium">
              {status === "connecting" ? "Reconnecting…" : "Connection lost"}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
