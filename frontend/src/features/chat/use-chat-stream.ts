"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { ApiError } from "@/lib/api";
import { streamPost } from "@/lib/sse";
import type { ChatRequest } from "@/types/api";

import { initialStream, streamReducer } from "./stream-state";

export function useChatStream(opts: { onDone?: (conversationId: string) => void; onSettled?: (conversationId: string | null, aborted: boolean) => void } = {}) {
  const [state, dispatch] = useReducer(streamReducer, initialStream);
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const run = useCallback(async (path: string, body: unknown, question: string | null, knownConversation: string | null) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    convRef.current = knownConversation;
    dispatch({ type: "start", question });
    let finished = false;
    try {
      await streamPost(
        path,
        body,
        (event) => {
          if (event.type === "meta") convRef.current = event.conversation_id;
          if (event.type === "done" || event.type === "error") finished = true;
          dispatch({ type: "event", event });
        },
        ctrl.signal,
      );
      if (!finished && !ctrl.signal.aborted) dispatch({ type: "failed", message: "The connection closed before the answer finished." });
    } catch (e) {
      if ((e as Error).name !== "AbortError") dispatch({ type: "failed", message: e instanceof ApiError ? e.message : "Network error. Please retry.", code: e instanceof ApiError ? e.code : undefined });
    }
    const aborted = ctrl.signal.aborted;
    if (aborted) dispatch({ type: "abort" });
    if (abortRef.current === ctrl) abortRef.current = null;
    if (finished && !aborted && convRef.current) optsRef.current.onDone?.(convRef.current);
    optsRef.current.onSettled?.(convRef.current, aborted);
  }, []);

  const send = useCallback((req: ChatRequest) => run("/chat/stream", req, req.question, req.conversation_id ?? null), [run]);
  const regenerate = useCallback((conversationId: string) => run(`/conversations/${conversationId}/regenerate`, {}, null, conversationId), [run]);
  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { state, send, regenerate, stop, reset };
}
