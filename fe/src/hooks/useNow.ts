"use client";

import { useEffect, useState } from "react";

/**
 * Tick-driven current timestamp. Renders once with initial Date.now(), then
 * refreshes at `intervalMs` cadence. Use this instead of reading Date.now()
 * directly in render — the latter is impure and trips React 19's purity rules.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
