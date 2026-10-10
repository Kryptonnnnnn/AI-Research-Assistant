import { buildUrl, parseError } from "@/lib/api";
import type { ChatEvent } from "@/types/api";

/** Incremental SSE parser: feed text chunks (any boundaries), get complete events back. */
export class SseParser {
  private buffer = "";
  push(chunk: string): ChatEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: ChatEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const ev = parseBlock(raw);
      if (ev) events.push(ev);
    }
    return events;
  }
  /** Flush any trailing complete-but-unterminated block at end of stream. */
  flush(): ChatEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    const ev = parseBlock(rest);
    return ev ? [ev] : [];
  }
}

function parseBlock(raw: string): ChatEvent | null {
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue; // comment / keep-alive
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return null;
  try {
    return JSON.parse(data.join("\n")) as ChatEvent;
  } catch {
    return null;
  }
}

/**
 * POST to an SSE endpoint and invoke onEvent for each event.
 * Rejects with ApiError for HTTP errors (e.g. 404 on someone else's conversation).
 * Resolves when the stream ends; aborting via the signal resolves quietly.
 */
export async function streamPost(
  path: string,
  body: unknown,
  onEvent: (ev: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body ?? {}),
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw new Error("Streaming is not supported by this browser.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) onEvent(ev);
    }
    for (const ev of parser.flush()) onEvent(ev);
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw e;
  }
}
