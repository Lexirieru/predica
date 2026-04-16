"use client";

import { useState } from "react";

// CoinGecko logo URLs per token symbol. Keep in sync with BE CURATED_SYMBOLS
// in be/src/lib/crons.ts. Any symbol not in this map falls back to a colored
// circle with its first letter (same treatment as the old emoji mapping).
const LOGOS: Record<string, string> = {
  BTC: "https://assets.coingecko.com/coins/images/1/standard/bitcoin.png?1696501400",
  ETH: "https://assets.coingecko.com/coins/images/279/standard/ethereum.png?1696501628",
  SOL: "https://assets.coingecko.com/coins/images/4128/standard/solana.png?1718769756",
  BNB: "https://assets.coingecko.com/coins/images/825/standard/bnb-icon2_2x.png?1696501970",
  XRP: "https://assets.coingecko.com/coins/images/44/standard/xrp-symbol-white-128.png?1696501442",
  DOGE: "https://assets.coingecko.com/coins/images/5/standard/dogecoin.png?1696501409",
  ADA: "https://assets.coingecko.com/coins/images/975/standard/cardano.png?1696502090",
  AVAX: "https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png?1696512369",
  SUI: "https://assets.coingecko.com/coins/images/26375/standard/sui-ocean-square.png?1727791290",
  LINK: "https://assets.coingecko.com/coins/images/877/standard/Chainlink_Logo_500.png?1760023405",
  LTC: "https://assets.coingecko.com/coins/images/2/standard/litecoin.png?1696501400",
  TON: "https://assets.coingecko.com/coins/images/17980/standard/photo_2024-09-10_17.09.00.jpeg?1725963446",
  AAVE: "https://assets.coingecko.com/coins/images/12645/standard/aave-token-round.png?1720472354",
  NEAR: "https://assets.coingecko.com/coins/images/10365/standard/near.jpg?1696510367",
  ARB: "https://assets.coingecko.com/coins/images/16547/standard/arb.jpg?1721358242",
  UNI: "https://assets.coingecko.com/coins/images/12504/standard/uniswap-logo.png?1720676669",
  HYPE: "https://assets.coingecko.com/coins/images/50882/standard/hyperliquid.jpg?1729431300",
  TAO: "https://assets.coingecko.com/coins/images/28452/standard/ARUsPeNQ_400x400.jpeg?1696527447",
  JUP: "https://assets.coingecko.com/coins/images/34188/standard/jup.png?1704266489",
  WLD: "https://assets.coingecko.com/coins/images/31069/standard/worldcoin.jpeg?1696529903",
  TRUMP: "https://assets.coingecko.com/coins/images/53746/standard/trump.png?1737171561",
  PUMP: "https://assets.coingecko.com/coins/images/67164/standard/pump.jpg?1751949376",
  BCH: "https://assets.coingecko.com/coins/images/780/standard/bitcoin-cash-circle.png?1696501932",
  XMR: "https://assets.coingecko.com/coins/images/69/standard/monero_logo.png?1696501460",
};

interface Props {
  symbol: string;
  size?: number; // px, default 40
  className?: string;
}

export default function TokenIcon({ symbol, size = 40, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const sym = symbol.toUpperCase();
  const src = LOGOS[sym];

  if (!src || failed) {
    // Fallback: colored circle with first letter, same visual weight as a logo
    // so layout doesn't jump when an image errors.
    return (
      <div
        className={`rounded-full bg-linear-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold shrink-0 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {sym[0]}
      </div>
    );
  }

  // Plain <img> instead of next/image: CoinGecko URLs carry versioned query
  // strings and vary in aspect ratio. Using <img> avoids the next.config
  // remotePatterns churn for a hackathon demo asset. Image is cached by the
  // browser + CoinGecko CDN, so perf is fine.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={sym}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`rounded-full shrink-0 object-cover bg-white/5 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
