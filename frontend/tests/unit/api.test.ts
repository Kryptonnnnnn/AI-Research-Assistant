import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, buildUrl, parseError } from "@/lib/api";

describe("parseError", () => {
  it("reads the backend error envelope", async () => {
    const res = new Response(JSON.stringify({ error: { code: "validation_error", message: "Request validation failed", details: [{ field: "email", message: "bad" }] } }), { status: 422 });
    const err = await parseError(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: "validation_error", message: "Request validation failed" });
    expect(err.details).toEqual([{ field: "email", message: "bad" }]);
  });

  it("falls back gracefully on non-JSON bodies", async () => {
    const err = await parseError(new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    expect(err).toMatchObject({ status: 502, code: "http_502", message: "Bad Gateway" });
  });
});

describe("api()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds query strings, skipping empty values", () => {
    expect(buildUrl("/documents", { page: 2, q: "", status: undefined, sort: "title" })).toBe("/api/v1/documents?page=2&sort=title");
  });

  it("sends JSON with same-origin credentials and returns parsed data", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await expect(api("/x", { method: "POST", body: { a: 1 } })).resolves.toEqual({ ok: 1 });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns undefined for 204 and throws ApiError otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api("/x", { method: "DELETE" })).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "conflict", message: "exists" } }), { status: 409 })));
    await expect(api("/x", { method: "POST" })).rejects.toMatchObject({ status: 409, code: "conflict" });
  });
});
