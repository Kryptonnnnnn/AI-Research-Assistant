import type { ChatEvent, MessageOut, SourceOut } from "@/types/api";

export interface StreamState {
  phase: "idle" | "streaming";
  conversationId: string | null;
  userMessageId: string | null;
  question: string | null;
  sources: SourceOut[];
  text: string;
  final: MessageOut | null;
  error: { code: string; message: string; messageId?: string } | null;
}

export const initialStream: StreamState = {
  phase: "idle",
  conversationId: null,
  userMessageId: null,
  question: null,
  sources: [],
  text: "",
  final: null,
  error: null,
};

export type StreamAction = { type: "start"; question: string | null } | { type: "event"; event: ChatEvent } | { type: "abort" } | { type: "failed"; message: string; code?: string } | { type: "reset" };

/** Pure reducer folding SSE events into UI state. */
export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "start":
      return { ...initialStream, phase: "streaming", question: action.question, conversationId: state.conversationId };
    case "reset":
      return initialStream;
    case "abort":
      return { ...state, phase: "idle" };
    case "failed":
      return { ...state, phase: "idle", error: { code: action.code ?? "network_error", message: action.message } };
    case "event": {
      const ev = action.event;
      switch (ev.type) {
        case "meta":
          return { ...state, conversationId: ev.conversation_id, userMessageId: ev.user_message_id };
        case "sources":
          return { ...state, sources: ev.sources };
        case "token":
          return { ...state, text: state.text + ev.text };
        case "done":
          return { ...state, phase: "idle", final: ev.message, text: ev.message.content };
        case "error":
          return { ...state, phase: "idle", error: { code: ev.code, message: ev.message, messageId: ev.message_id } };
      }
    }
  }
}
