"use client";

import { useState, useEffect, useRef } from "react";

interface FloatingTrade {
  id: number;
  amount: number;
  side: "up" | "down";
  x: number; // percent from left
  y: number; // percent from top
}

const AMOUNTS = [1, 1, 2, 3, 5, 5, 10, 10, 15, 20, 24, 30, 50, 75, 100, 150];

export default function LiveTrades() {
  const [trades, setTrades] = useState<FloatingTrade[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const addTrade = () => {
      const trade: FloatingTrade = {
        id: nextId.current++,
        amount: AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)],
        side: Math.random() > 0.45 ? "up" : "down",
        x: 5 + Math.random() * 55, // left 5-60%
        y: 20 + Math.random() * 60, // top 20-80%
      };

      setTrades((prev) => {
        const next = [...prev, trade];
        if (next.length > 6) return next.slice(-6);
        return next;
      });

      // Remove after animation
      setTimeout(() => {
        setTrades((prev) => prev.filter((t) => t.id !== trade.id));
      }, 2500);

      timeout = setTimeout(addTrade, 600 + Math.random() * 1400);
    };

    let timeout = setTimeout(addTrade, 500);
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
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          15% {
            opacity: 1;
            transform: translateY(0);
          }
          70% {
            opacity: 0.7;
            transform: translateY(-12px);
          }
          100% {
            opacity: 0;
            transform: translateY(-20px);
          }
        }
      `}</style>
    </>
  );
}
