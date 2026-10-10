import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initialStream, streamReducer } from "@/features/chat/stream-state";
import { useChatStream } from "@/features/chat/use-chat-stream";
import type { MessageOut } from "@/types/api";

const msg = (over: Partial<MessageOut> = {}): MessageOut => ({
  id: "m2", conversation_id: "c1", role: "assistant", content: "Final answer [S1]", status: "complete", mode: "qa", provider: "mock", model: "mock-1",
  error: null, retrieval_meta: {}, created_at: "2026-01-01T00:00:00Z", citations: [], ...over,
});
const frame = (e: object) => `data: ${JSON.stringify(e)}\n\n`;

describe("streamReducer", () => {
  it("folds meta → sources → tokens → done", () => {
    let s = streamReducer(initialStream, { type: "start", question: "Q?" });
    expect(s).toMatchObject({ phase: "streaming", question: "Q?" });
    s = streamReducer(s, { type: "event", event: { type: "meta", conversation_id: "c1", user_message_id: "u1" } });
    s = streamReducer(s, { type: "event", event: { type: "sources", sources: [{ label: "S1" } as never] } });
    s = streamReducer(s, { type: "event", event: { type: "token", text: "Hel" } });
    s = streamReducer(s, { type: "event", event: { type: "token", text: "lo" } });
    expect(s).toMatchObject({ conversationId: "c1", userMessageId: "u1", text: "Hello" });
    expect(s.sources).toHaveLength(1);
    s = streamReducer(s, { type: "event", event: { type: "done", message: msg() } });
    expect(s).toMatchObject({ phase: "idle", text: "Final answer [S1]" });
    expect(s.final?.id).toBe("m2");
  });

  it("records provider errors with the saved message id and supports abort/reset", () => {
    let s = streamReducer(initialStream, { type: "start", question: null });
    s = streamReducer(s, { type: "event", event: { type: "error", code: "provider_timeout", message: "slow", message_id: "m9" } });
    expect(s).toMatchObject({ phase: "idle", error: { code: "provider_timeout", messageId: "m9" } });
    expect(streamReducer({ ...s, phase: "streaming" }, { type: "abort" }).phase).toBe("idle");
    expect(streamReducer(s, { type: "reset" })).toEqual(initialStream);
  });
});

function sseResponse(frames: string[], signal?: AbortSignal, hang = false) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        frames.forEach((f) => c.enqueue(enc.encode(f)));
        if (!hang) c.close();
        signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    }),
    { status: 200 },
  );
}

describe("useChatStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams an answer and reports completion", async () => {
    const onDone = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      frame({ type: "meta", conversation_id: "c1", user_message_id: "u1" }),
      frame({ type: "sources", sources: [{ label: "S1" }] }),
      frame({ type: "token", text: "Answer " }), frame({ type: "token", text: "text [S1]" }),
      frame({ type: "done", message: msg({ content: "Answer text [S1]" }) }),
    ])));
    const { result } = renderHook(() => useChatStream({ onDone }));
    await act(async () => { await result.current.send({ question: "Q?", document_ids: [], mode: "qa" }); });
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.final?.content).toBe("Answer text [S1]");
    expect(result.current.state.conversationId).toBe("c1");
    expect(onDone).toHaveBeenCalledWith("c1");
    const body = JSON.parse(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ question: "Q?", mode: "qa", document_ids: [] });
  });

  it("stop() aborts the request and leaves the partial text for the server-saved message", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => sseResponse(
      [frame({ type: "meta", conversation_id: "c1", user_message_id: "u1" }), frame({ type: "token", text: "partial" })], init.signal as AbortSignal, true)));
    const onSettled = vi.fn();
    const { result } = renderHook(() => useChatStream({ onSettled }));
    let p!: Promise<void>;
    act(() => { p = result.current.send({ question: "Q?", document_ids: [], mode: "qa" }); });
    await waitFor(() => expect(result.current.state.text).toBe("partial"));
    act(() => result.current.stop());
    await act(async () => { await p; });
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.text).toBe("partial");
    expect(onSettled).toHaveBeenCalledWith("c1", true);
  });

  it("surfaces HTTP errors and truncated streams", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_found", message: "Document not found" } }), { status: 404 })));
    const { result } = renderHook(() => useChatStream());
    await act(async () => { await result.current.send({ question: "Q?", document_ids: ["x"], mode: "qa" }); });
    expect(result.current.state.error).toMatchObject({ code: "not_found", message: "Document not found" });

    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([frame({ type: "token", text: "cut" })])));
    await act(async () => { await result.current.send({ question: "Q?", document_ids: [], mode: "qa" }); });
    expect(result.current.state.error?.message).toMatch(/connection closed/);
  });

  it("regenerate() posts to the conversation's regenerate endpoint", async () => {
    const f = vi.fn(async () => sseResponse([frame({ type: "meta", conversation_id: "c1", user_message_id: "u1" }), frame({ type: "done", message: msg() })]));
    vi.stubGlobal("fetch", f);
    const { result } = renderHook(() => useChatStream());
    await act(async () => { await result.current.regenerate("c1"); });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("/api/v1/conversations/c1/regenerate");
    expect(result.current.state.question).toBeNull();
  });
});
