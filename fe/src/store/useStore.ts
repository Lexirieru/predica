"use client";

import { create } from "zustand";
import { PredictionMarket, TradeSide } from "@/lib/types";

interface StoreState {
  currentMarketIndex: number;
  markets: PredictionMarket[];
  tradeModalOpen: boolean;
  tradeModalSide: TradeSide | null;
  tradeModalMarketId: string | null;

  setCurrentMarketIndex: (index: number) => void;
  setMarkets: (markets: PredictionMarket[]) => void;
  openTradeModal: (marketId: string, side: TradeSide) => void;
  closeTradeModal: () => void;
}

export const useStore = create<StoreState>((set) => ({
  currentMarketIndex: 0,
  markets: [],
  tradeModalOpen: false,
  tradeModalSide: null,
  tradeModalMarketId: null,

  setCurrentMarketIndex: (index) => set({ currentMarketIndex: index }),
  setMarkets: (markets) => set({ markets }),
  openTradeModal: (marketId, side) =>
    set({
      tradeModalOpen: true,
      tradeModalSide: side,
      tradeModalMarketId: marketId,
    }),
  closeTradeModal: () =>
    set({
      tradeModalOpen: false,
      tradeModalSide: null,
      tradeModalMarketId: null,
    }),
}));
