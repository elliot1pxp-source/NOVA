"use client";

import { useEffect, useState } from "react";

/**
 * Returns true when the viewport is below the given breakpoint (default 768px,
 * Tailwind's `md`). Used to disable drag/resize affordances on touch devices
 * where they conflict with native scroll/zoom.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return isMobile;
}
