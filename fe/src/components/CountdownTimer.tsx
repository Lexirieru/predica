"use client";

import { useState, useEffect } from "react";

export default function CountdownTimer({ deadline }: { deadline: number }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) {
        setTimeLeft("Expired");
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);

      if (days > 0) setTimeLeft(`${days}d ${hours}h`);
      else if (hours > 0) setTimeLeft(`${hours}h ${minutes}m`);
      else setTimeLeft(`${minutes}m`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [deadline]);

  const diff = deadline - Date.now();
  const isUrgent = diff < 86400000 && diff > 0;
  const isExpired = diff <= 0;

  return (
    <span
      className={`text-xs font-semibold tabular-nums ${
        isExpired
          ? "text-white/30"
          : isUrgent
            ? "text-(--color-no)"
            : "text-white/50"
      }`}
      style={isUrgent ? { animation: "pulse-glow 2s ease-in-out infinite" } : undefined}
    >
      {timeLeft}
    </span>
  );
}
