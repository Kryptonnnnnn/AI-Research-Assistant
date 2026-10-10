import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";

export function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Handler = ((url: URL, init?: RequestInit) => Response | Promise<Response> | unknown) | object;

/** Route-based fetch mock: keys are path prefixes (without /api/v1). Longest prefix wins; unmatched → 404 JSON error. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    calls.push({ url, init });
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const key = Object.keys(routes)
      .filter((k) => path === k || path.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return json({ error: { code: "not_found", message: `unmocked ${path}` } }, 404);
    const h = routes[key];
    const out = typeof h === "function" ? await h(url, init) : h;
    return out instanceof Response ? out : json(out);
  });
  vi.stubGlobal("fetch", impl);
  return { calls, fetch: impl };
}

export const nextNavigationMock = () => {
  const push = vi.fn();
  const replace = vi.fn();
  return { push, replace, module: { useRouter: () => ({ push, replace, back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/chat", useSearchParams: () => new URLSearchParams() } };
};
