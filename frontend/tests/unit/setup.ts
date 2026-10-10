import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom gaps that cmdk / base-ui rely on
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

/** Test helper: pretend the viewport is `width` px wide for min-width media queries (jsdom has no matchMedia). */
export function mockViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: m ? width >= Number(m[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    } as MediaQueryList;
  }) as typeof window.matchMedia;
}
