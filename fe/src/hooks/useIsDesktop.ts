"use client";

import { useEffect, useState } from "react";

/**
 * Returns true once the viewport is ≥ md breakpoint (768px by default). Always
 * false on the first render so SSR + initial hydration produce the mobile
 * markup; on a desktop viewport it flips to true on the next paint after
 * mount. The brief mobile→desktop flash on wide screens is acceptable for
 * the hackathon — alternative (rendering both subtrees with CSS toggling) would
 * double-mount data hooks and WebSocket subscribers.
 */
export function useIsDesktop(breakpoint = 768): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = () => setIsDesktop(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isDesktop;
}
