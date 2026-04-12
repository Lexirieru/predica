"use client";

import { useId } from "react";

function shortPrice(p: number): string {
  if (p >= 10000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (p >= 100) return `$${p.toFixed(1)}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

export default function PriceChart({
  data,
  isPositive,
  targetPrice,
}: {
  data: number[];
  isPositive: boolean;
  targetPrice?: number;
}) {
  const uid = useId();
  if (data.length < 2) return null;

  const chartW = 260;
  const chartH = 90;
  const padL = 4;
  const padR = 40; // space for price labels
  const padY = 8;
  const w = chartW - padR;

  const allVals = targetPrice ? [...data, targetPrice] : data;
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const rawRange = rawMax - rawMin || 1;
  // Add 40% vertical padding so the line sits in the middle, not flat edge-to-edge
  const padding40 = rawRange * 0.4;
  const min = rawMin - padding40;
  const max = rawMax + padding40;
  const range = max - min;
  const toY = (v: number) => padY + (1 - (v - min) / range) * (chartH - padY * 2);

  const pts = data.map((v, i) => ({
    x: padL + (i / (data.length - 1)) * (w - padL),
    y: toY(v),
  }));

  const line = pts.map((p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    return `C ${prev.x + (p.x - prev.x) * 0.4} ${prev.y}, ${prev.x + (p.x - prev.x) * 0.6} ${p.y}, ${p.x} ${p.y}`;
  }).join(" ");

  const area = `${line} L ${pts[pts.length - 1].x} ${chartH} L ${pts[0].x} ${chartH} Z`;
  const color = isPositive ? "#00b482" : "#dc3246";
  const glow = isPositive ? "rgba(0,180,130,0.3)" : "rgba(220,50,70,0.3)";
  const gId = `g-${uid}`;
  const fId = `f-${uid}`;
  const last = pts[pts.length - 1];
  const targetY = targetPrice ? toY(targetPrice) : null;

  // Price labels on right axis — 5 ticks for better readability
  const priceTicks = [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => min + range * p);

  return (
    <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <filter id={fId} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Grid + price labels */}
      {priceTicks.map((p, i) => {
        const y = toY(p);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={w} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
            <text x={w + 4} y={y + 3} fill="rgba(255,255,255,0.15)" fontSize="6.5" fontFamily="monospace">
              {shortPrice(p)}
            </text>
          </g>
        );
      })}

      {/* Target dashed line */}
      {targetY !== null && (
        <>
          <line x1={padL} y1={targetY} x2={w} y2={targetY}
            stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" strokeDasharray="3 2"
            style={{ transition: "y1 0.5s, y2 0.5s" }}
          />
          <rect x={w - 32} y={targetY - 7} width="32" height="12" rx="3" fill="rgba(255,255,255,0.06)" />
          <text x={w - 16} y={targetY + 1} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="6" fontFamily="monospace">
            Target
          </text>
        </>
      )}

      {/* Area */}
      <path d={area} fill={`url(#${gId})`} style={{ transition: "d 0.8s cubic-bezier(0.23,1,0.32,1)" }} />

      {/* Line */}
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"
        strokeLinejoin="round" filter={`url(#${fId})`}
        style={{ transition: "d 0.8s cubic-bezier(0.23,1,0.32,1)" }}
      />

      {/* End dot */}
      <circle cx={last.x} cy={last.y} r="4" fill={glow} style={{ transition: "cx 0.8s, cy 0.8s" }}>
        <animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx={last.x} cy={last.y} r="2" fill={color} style={{ transition: "cx 0.8s, cy 0.8s" }} />
    </svg>
  );
}
