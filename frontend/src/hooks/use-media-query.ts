"use client";

import { useSyncExternalStore } from "react";

const supported = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/** SSR-safe media query hook (false on the server, during hydration, and where matchMedia is unavailable). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (!supported()) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => (supported() ? window.matchMedia(query).matches : false),
    () => false,
  );
}
