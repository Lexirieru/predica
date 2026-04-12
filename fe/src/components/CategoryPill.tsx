"use client";

import { PredictionMarket } from "@/lib/types";

const categoryConfig: Record<
  PredictionMarket["category"],
  { label: string; color: string; icon: React.ReactNode }
> = {
  crypto: {
    label: "Crypto",
    color: "#F7931A",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M6 1v10M4 3h5a1.5 1.5 0 010 3H3.5M4 6h4.5a1.5 1.5 0 010 3H4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  defi: {
    label: "DeFi",
    color: "#8B5CF6",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 6h4M6 4v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  meme: {
    label: "Meme",
    color: "#FACC15",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="4.5" cy="5" r="0.7" fill="currentColor" />
        <circle cx="7.5" cy="5" r="0.7" fill="currentColor" />
        <path d="M4 7.5c.5 1 3.5 1 4 0" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    ),
  },
  layer1: {
    label: "L1",
    color: "#3B82F6",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1L11 6L6 11L1 6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    ),
  },
  layer2: {
    label: "L2",
    color: "#06B6D4",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 2L10 5L6 8L2 5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M2 7l4 3 4-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
};

export default function CategoryPill({
  category,
}: {
  category: PredictionMarket["category"];
}) {
  const config = categoryConfig[category];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
      style={{
        color: config.color,
        backgroundColor: `${config.color}10`,
        borderColor: `${config.color}20`,
      }}
    >
      {config.icon}
      {config.label}
    </span>
  );
}
