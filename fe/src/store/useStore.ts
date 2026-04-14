"use client";

import { create } from "zustand";
import { PredictionMarket, TradeSide } from "@/lib/types";

interface StoreState {
  currentMarketIndex: number;
  markets: PredictionMarket[];
  tradeModalOpen: boolean;
  tradeModalSide: TradeSide | null;
  tradeModalMarketId: string | null;
  balance: number;
  walletAddress: string | null;

  setCurrentMarketIndex: (index: number) => void;
  setMarkets: (markets: PredictionMarket[]) => void;
  openTradeModal: (marketId: string, side: TradeSide) => void;
  closeTradeModal: () => void;
  setBalance: (balance: number) => void;
  setWalletAddress: (address: string | null) => void;
}

export const useStore = create<StoreState>((set) => ({
  currentMarketIndex: 0,
  markets: [],
  tradeModalOpen: false,
  tradeModalSide: null,
  tradeModalMarketId: null,
  balance: 0,
  walletAddress: null,

  setCurrentMarketIndex: (index) => set({ currentMarketIndex: index }),
  setMarkets: (markets) => set({ markets }),
  openTradeModal: (marketId, side) =>
    set({ tradeModalOpen: true, tradeModalSide: side, tradeModalMarketId: marketId }),
  closeTradeModal: () =>
    set({ tradeModalOpen: false, tradeModalSide: null, tradeModalMarketId: null }),
  setBalance: (balance) => set({ balance }),
  setWalletAddress: (address) => set({ walletAddress: address }),
}));
