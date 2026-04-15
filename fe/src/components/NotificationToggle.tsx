"use client";

import { useEffect, useState } from "react";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import type { Provider } from "@reown/appkit-adapter-solana";
import {
  detectPushSupport,
  getCurrentSubscription,
  getVapidPublicKey,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pushNotifications";

type State =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; enabled: boolean }
  | { kind: "busy"; was: boolean };

export default function NotificationToggle() {
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Provider>("solana");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const support = detectPushSupport();
      if (!support.supported) {
        if (!cancelled) setState({ kind: "unavailable", reason: "Your browser doesn't support push notifications" });
        return;
      }
      // BE might have VAPID disabled — we probe the key endpoint; a 503 means
      // push is off server-side and toggling would just error out, so hide it.
      const key = await getVapidPublicKey();
      if (!key) {
        if (!cancelled) setState({ kind: "unavailable", reason: "Push notifications aren't enabled on this server" });
        return;
      }

      const sub = await getCurrentSubscription();
      if (!cancelled) setState({ kind: "ready", enabled: !!sub });
    })();
    return () => { cancelled = true; };
  }, []);

  const canToggle = isConnected && !!address && !!walletProvider && state.kind === "ready";

  const handleToggle = async () => {
    if (!canToggle || !address || !walletProvider) return;
    const was = (state as { enabled: boolean }).enabled;
    setState({ kind: "busy", was });
    setMessage("");

    const result = was
      ? await unsubscribeFromPush(address, walletProvider)
      : await subscribeToPush(address, walletProvider);

    if (result.ok) {
      setState({ kind: "ready", enabled: !was });
      setMessage(was ? "Notifications disabled" : "Notifications enabled");
    } else {
      setState({ kind: "ready", enabled: was });
      const msg = {
        "unsupported": "Browser doesn't support push",
        "permission-denied": "Allow notifications in browser settings",
        "no-vapid": "Push is off server-side",
        "sign-failed": "Wallet signature was rejected",
        "server-error": result.detail || "Server error",
      }[result.reason];
      setMessage(msg);
    }
  };

  if (state.kind === "loading") {
    return (
      <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-white/40 text-xs">Checking notifications…</p>
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
        <p className="text-white/60 text-xs font-medium mb-0.5">Push Notifications</p>
        <p className="text-white/30 text-[11px]">{state.reason}</p>
      </div>
    );
  }

  const enabled = state.kind === "ready" ? state.enabled : state.was;
  const busy = state.kind === "busy";

  return (
    <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-white text-xs font-medium">Push Notifications</p>
        <p className="text-white/30 text-[11px] leading-tight">
          {message || (enabled ? "Get notified when your markets resolve" : "Enable to hear results even when Predica is closed")}
        </p>
      </div>
      <button
        onClick={handleToggle}
        disabled={!canToggle || busy}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
          enabled ? "bg-[#00b482]" : "bg-white/10"
        } disabled:opacity-40`}
        aria-pressed={enabled}
        aria-label="Toggle push notifications"
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-[left] duration-150 ${
            enabled ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
