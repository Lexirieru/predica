"use client";

import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

interface FloatingTrade {
  id: number;
  amount: number;
  side: "up" | "down";
  x: number;
  y: number;
  wallet: string;
}

export default function LiveTrades({ marketId }: { marketId?: string }) {
  const [trades, setTrades] = useState<FloatingTrade[]>([]);
  const nextId = useRef(0);

  // Real trades from WS
  useWebSocket("NEW_VOTE", (data) => {
    const vote = data as { marketId: string; side: string; amount: number; wallet: string };
    // Show all votes, or filter by marketId if provided
    if (marketId && vote.marketId !== marketId) return;

    const trade: FloatingTrade = {
      id: nextId.current++,
      amount: vote.amount,
      side: vote.side === "yes" ? "up" : "down",
      x: 5 + Math.random() * 55,
      y: 20 + Math.random() * 60,
      wallet: vote.wallet,
    };

    setTrades((prev) => {
      const next = [...prev, trade];
      if (next.length > 6) return next.slice(-6);
      return next;
    });

    setTimeout(() => {
      setTrades((prev) => prev.filter((t) => t.id !== trade.id));
    }, 2500);
  });

  // Simulated activity when no real votes (keep it lively for demo)
  useEffect(() => {
    const amounts = [1, 2, 5, 10, 15, 20, 50, 100];
    const add = () => {
      const trade: FloatingTrade = {
        id: nextId.current++,
        amount: amounts[Math.floor(Math.random() * amounts.length)],
        side: Math.random() > 0.45 ? "up" : "down",
        x: 5 + Math.random() * 55,
        y: 20 + Math.random() * 60,
        wallet: "",
      };
      setTrades((prev) => {
        const next = [...prev, trade];
        if (next.length > 6) return next.slice(-6);
        return next;
      });
      setTimeout(() => {
        setTrades((prev) => prev.filter((t) => t.id !== trade.id));
      }, 2500);
      timeout = setTimeout(add, 2000 + Math.random() * 4000);
    };
    let timeout = setTimeout(add, 3000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <>
      {trades.map((t) => (
        <div
          key={t.id}
          className="absolute pointer-events-none text-[11px] font-bold tabular-nums"
          style={{
            left: `${t.x}%`,
            top: `${t.y}%`,
            color: t.side === "up" ? "#00b482" : "#dc3246",
            animation: "tradeFloat 2.5s ease-out forwards",
          }}
        >
          + ${t.amount}
        </div>
      ))}
      <style jsx>{`
        @keyframes tradeFloat {
          0% { opacity: 0; transform: translateY(8px); }
          15% { opacity: 1; transform: translateY(0); }
          70% { opacity: 0.7; transform: translateY(-12px); }
          100% { opacity: 0; transform: translateY(-20px); }
        }
      `}</style>
    </>
  );
}
