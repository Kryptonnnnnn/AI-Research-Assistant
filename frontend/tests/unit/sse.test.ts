import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { SseParser, streamPost } from "@/lib/sse";
import type { ChatEvent } from "@/types/api";

const frame = (e: object) => `event: x\ndata: ${JSON.stringify(e)}\n\n`;

describe("SseParser", () => {
  it("parses complete events", () => {
    const p = new SseParser();
    const out = p.push(frame({ type: "token", text: "Hi" }) + frame({ type: "token", text: " there" }));
    expect(out).toEqual([
      { type: "token", text: "Hi" },
      { type: "token", text: " there" },
    ]);
  });

  it("handles events split across arbitrary chunk boundaries", () => {
    const p = new SseParser();
    const raw = frame({ type: "token", text: "héllo" }) + frame({ type: "done", message: { id: "1" } });
    const events: ChatEvent[] = [];
    for (let i = 0; i < raw.length; i += 3) events.push(...p.push(raw.slice(i, i + 3)));
    expect(events.map((e) => e.type)).toEqual(["token", "done"]);
    expect((events[0] as { text: string }).text).toBe("héllo");
  });

  it("handles CRLF, comments and ignores malformed JSON", () => {
    const p = new SseParser();
    const out = p.push(`: keep-alive\r\n\r\nevent: x\r\ndata: {"type":"token","text":"a"}\r\n\r\ndata: {not json}\n\n`);
    expect(out).toEqual([{ type: "token", text: "a" }]);
  });

  it("joins multi-line data fields and flushes a trailing block", () => {
    const p = new SseParser();
    expect(p.push('data: {"type":\ndata: "token","text":"x"}\n\n')).toEqual([{ type: "token", text: "x" }]);
    expect(p.push('data: {"type":"error","code":"c","message":"m"}')).toEqual([]);
    expect(p.flush()).toEqual([{ type: "error", code: "c", message: "m" }]);
  });
});

function streamOf(chunks: string[], opts: { hang?: boolean; signal?: AbortSignal } = {}) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((x) => c.enqueue(enc.encode(x)));
      if (!opts.hang) c.close();
      opts.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
    },
  });
}

describe("streamPost", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("emits events in order across chunks", async () => {
    const body = frame({ type: "meta", conversation_id: "c", user_message_id: "u" }) + frame({ type: "token", text: "A" }) + frame({ type: "error", code: "provider_timeout", message: "slow" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf([body.slice(0, 40), body.slice(40)]), { status: 200 })));
    const seen: ChatEvent[] = [];
    await streamPost("/chat/stream", { q: 1 }, (e) => seen.push(e));
    expect(seen.map((e) => e.type)).toEqual(["meta", "token", "error"]);
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/v1/chat/stream");
    expect(call[1].credentials).toBe("same-origin");
  });

  it("rejects with ApiError on HTTP errors (e.g. someone else's conversation)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_found", message: "Conversation not found" } }), { status: 404 })));
    await expect(streamPost("/conversations/x/regenerate", {}, () => {})).rejects.toMatchObject({ status: 404, code: "not_found", message: "Conversation not found" });
    await expect(streamPost("/x", {}, () => {})).rejects.toBeInstanceOf(ApiError);
  });

  it("resolves quietly when aborted mid-stream", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => new Response(streamOf([frame({ type: "token", text: "A" })], { hang: true, signal: init.signal as AbortSignal }), { status: 200 })),
    );
    const seen: ChatEvent[] = [];
    const p = streamPost("/chat/stream", {}, (e) => seen.push(e), ctrl.signal);
    await new Promise((r) => setTimeout(r, 20));
    ctrl.abort();
    await expect(p).resolves.toBeUndefined();
    expect(seen).toEqual([{ type: "token", text: "A" }]);
  });
});
