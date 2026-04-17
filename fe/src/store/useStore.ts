"use client";

import { create } from "zustand";
import { PredictionMarket, TradeSide } from "@/lib/types";

export type ToastKind = "success" | "error" | "info";
export interface Toast {
  id: string;
  kind: ToastKind;
  text: string;
}

export interface PendingVote {
  /** Local-only id so reconcile can target the right placeholder. */
  tempId: string;
  marketId: string;
  side: TradeSide;
  amount: number;
  wallet: string;
  createdAt: number;
}

interface StoreState {
  currentMarketIndex: number;
  markets: PredictionMarket[];
  tradeModalOpen: boolean;
  tradeModalSide: TradeSide | null;
  tradeModalMarketId: string | null;
  balance: number;
  walletAddress: string | null;

  // Cross-page navigation: when set (e.g. by explore page clicking a card),
  // the feed page's SwipeStack reads this and jumps to the matching card.
  // Format: `${symbol}:${durationMin}`. Cleared after consumption.
  // We can't just set currentMarketIndex from explore because the feed's
  // displayed list (activeMarkets) is filtered + shuffled — its indices
  // don't line up with the raw markets array.
  targetMarketKey: string | null;

  // Optimistic-vote layer
  pendingVotes: PendingVote[];
  toasts: Toast[];

  setCurrentMarketIndex: (index: number) => void;
  setTargetMarketKey: (key: string | null) => void;
  setMarkets: (markets: PredictionMarket[]) => void;
  openTradeModal: (marketId: string, side: TradeSide) => void;
  closeTradeModal: () => void;
  setBalance: (balance: number) => void;
  setWalletAddress: (address: string | null) => void;

  /**
   * Apply an optimistic vote locally: debit balance, bump pool on the chosen
   * side, append to pendingVotes. Returns the tempId for later reconcile.
   */
  applyOptimisticVote: (input: {
    marketId: string;
    side: TradeSide;
    amount: number;
    wallet: string;
  }) => string;

  /**
   * BE confirmed the vote. Reconcile: drop the pending entry, replace balance
   * with server-authoritative value. Pool was already updated optimistically
   * and matches what the server broadcasts via NEW_VOTE, so no pool adjust.
   */
  confirmOptimisticVote: (tempId: string, confirmedBalance: number) => void;

  /**
   * BE rejected. Roll back balance + pool, drop pending entry, surface toast.
   */
  rollbackOptimisticVote: (tempId: string, reason: string) => void;

  pushToast: (kind: ToastKind, text: string) => void;
  dismissToast: (id: string) => void;
}

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useStore = create<StoreState>((set, get) => ({
  currentMarketIndex: 0,
  markets: [],
  tradeModalOpen: false,
  tradeModalSide: null,
  tradeModalMarketId: null,
  balance: 0,
  walletAddress: null,
  targetMarketKey: null,
  pendingVotes: [],
  toasts: [],

  setCurrentMarketIndex: (index) => set({ currentMarketIndex: index }),
  setTargetMarketKey: (key) => set({ targetMarketKey: key }),
  setMarkets: (markets) => set({ markets }),
  openTradeModal: (marketId, side) =>
    set({ tradeModalOpen: true, tradeModalSide: side, tradeModalMarketId: marketId }),
  closeTradeModal: () =>
    set({ tradeModalOpen: false, tradeModalSide: null, tradeModalMarketId: null }),
  setBalance: (balance) => set({ balance }),
  setWalletAddress: (address) => set({ walletAddress: address }),

  applyOptimisticVote: ({ marketId, side, amount, wallet }) => {
    const tempId = genId();
    set((state) => {
      const markets = state.markets.map((m) => {
        if (m.id !== marketId) return m;
        return {
          ...m,
          yesPool: side === "yes" ? m.yesPool + amount : m.yesPool,
          noPool: side === "no" ? m.noPool + amount : m.noPool,
          totalVoters: m.totalVoters + 1,
        };
      });
      return {
        markets,
        balance: state.balance - amount,
        pendingVotes: [
          ...state.pendingVotes,
          { tempId, marketId, side, amount, wallet, createdAt: Date.now() },
        ],
      };
    });
    return tempId;
  },

  confirmOptimisticVote: (tempId, confirmedBalance) => {
    set((state) => ({
      balance: confirmedBalance,
      pendingVotes: state.pendingVotes.filter((v) => v.tempId !== tempId),
    }));
  },

  rollbackOptimisticVote: (tempId, reason) => {
    const pending = get().pendingVotes.find((v) => v.tempId === tempId);
    if (!pending) return;
    set((state) => {
      const markets = state.markets.map((m) => {
        if (m.id !== pending.marketId) return m;
        return {
          ...m,
          yesPool: pending.side === "yes" ? Math.max(0, m.yesPool - pending.amount) : m.yesPool,
          noPool: pending.side === "no" ? Math.max(0, m.noPool - pending.amount) : m.noPool,
          totalVoters: Math.max(0, m.totalVoters - 1),
        };
      });
      return {
        markets,
        balance: state.balance + pending.amount,
        pendingVotes: state.pendingVotes.filter((v) => v.tempId !== tempId),
        toasts: [...state.toasts, { id: genId(), kind: "error", text: reason }],
      };
    });
  },

  pushToast: (kind, text) =>
    set((state) => ({ toasts: [...state.toasts, { id: genId(), kind, text }] })),

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
