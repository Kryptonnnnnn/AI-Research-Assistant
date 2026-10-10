"use client";

import { useCallback, useRef, useState } from "react";

/** Drag/keyboard resizing for a right-docked pane. Width is persisted in localStorage. */
export function useResizableWidth(storageKey: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return initial;
    const saved = Number(window.localStorage.getItem(storageKey));
    return saved >= min && saved <= max ? saved : initial;
  });
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const clamp = useCallback((w: number) => Math.min(max, Math.max(min, Math.round(w))), [min, max]);
  const persist = useCallback((w: number) => window.localStorage.setItem(storageKey, String(w)), [storageKey]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startW: width };
    },
    [width],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (drag.current) setWidth(clamp(drag.current.startW + (drag.current.startX - e.clientX)));
    },
    [clamp],
  );
  const onPointerUp = useCallback(() => {
    if (drag.current) persist(width);
    drag.current = null;
  }, [persist, width]);
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = clamp(width + (e.key === "ArrowLeft" ? 24 : -24));
      setWidth(next);
      persist(next);
    },
    [clamp, persist, width],
  );
  return { width, min, max, handleProps: { onPointerDown, onPointerMove, onPointerUp, onKeyDown } };
}
