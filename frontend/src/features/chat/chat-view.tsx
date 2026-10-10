"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, List, SendHorizontal, Sparkles, Square } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { NativeSelect } from "@/components/shared/native-select";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SaveNoteDialog } from "@/features/notes/save-note-dialog";
import { ChatErrorCard } from "./error-cards";
import { DockedViewer, ReopenViewerButton, useEvidence, useRegisterDock } from "./evidence";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { api, ApiError, downloadFromApi, postJson } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ConversationDetail, FollowUps, MessageOut, Mode } from "@/types/api";

import { ConversationList } from "./conversation-list";
import { AssistantBubble, StreamingBubble, UserBubble } from "./message-view";
import { ALL_SCOPE, ScopePicker, scopeFrom, type Scope } from "./scope-picker";
import { useChatStream } from "./use-chat-stream";

const STARTERS = ["Summarize the key findings across my documents.", "What methods are used, and what are their limitations?", "Where do the sources disagree?"];

export function ChatView({ conversationId }: { conversationId: string | null }) {
  useRegisterDock();
  const { docked, isOpen: viewerOpen, source: viewerSource } = useEvidence();
  const lgUp = useMediaQuery("(min-width: 1024px)");
  const roomy = useMediaQuery("(min-width: 1536px)");
  // When the viewer is docked, the conversation list yields space on mid-size screens (it stays reachable via "Chats").
  const listInline = lgUp && !(docked && viewerOpen && viewerSource && !roomy);
  const qc = useQueryClient();
  const sp = useSearchParams();
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const [mode, setMode] = useState<Mode>("qa");
  const [input, setInput] = useState(() => sp.get("q") ?? "");
  const [scope, setScope] = useState<Scope>(() => {
    const doc = sp.get("doc");
    const col = sp.get("collection");
    return doc ? scopeFrom([doc], null) : col ? scopeFrom([], col) : ALL_SCOPE;
  });
  const [followups, setFollowups] = useState<string[]>([]);
  const [saveMsg, setSaveMsg] = useState<MessageOut | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const scopeLoadedFor = useRef<string | null>(null);
  const stopRequested = useRef(false);
  const lastRequest = useRef<{ question: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);

  const conv = useQuery({
    queryKey: qk.conversation(activeId ?? "new"),
    queryFn: () => api<ConversationDetail>(`/conversations/${activeId}`),
    enabled: !!activeId,
  });
  const messages = useMemo(() => conv.data?.messages ?? [], [conv.data]);

  // Restore the saved scope when an existing conversation loads (also after refresh).
  useEffect(() => {
    if (conv.data && scopeLoadedFor.current !== conv.data.id) {
      scopeLoadedFor.current = conv.data.id;
      if (!sp.get("doc") && !sp.get("collection")) setScope(scopeFrom(conv.data.document_ids, conv.data.collection_id));
    }
  }, [conv.data, sp]);

  const { state, send, regenerate, stop, reset } = useChatStream();

  // After the first answer the URL is rewritten with history.replaceState, which leaves Next's route params stale (so the
  // page's `key` never changes). Follow the real pathname instead: "New conversation" and back/forward must reset the view.
  const pathname = usePathname();
  const routeId = pathname.startsWith("/chat/") ? pathname.slice("/chat/".length).split("/")[0] || null : null;
  const lastRoute = useRef(routeId);
  const ownUrlId = useRef<string | null>(null); // conversation id we just wrote into the URL ourselves
  const resetView = useCallback(
    (nextId: string | null) => {
      stop();
      reset();
      setFollowups([]);
      setSaveMsg(null);
      stick.current = true;
      scopeLoadedFor.current = null;
      setActiveId(nextId);
      if (!nextId) setScope(ALL_SCOPE);
    },
    [stop, reset],
  );
  useEffect(() => {
    if (lastRoute.current === routeId) return;
    lastRoute.current = routeId;
    if (routeId !== null && (routeId === ownUrlId.current || routeId === activeId)) return; // our own URL sync, not a navigation
    if (routeId === null && activeId === null) return; // already showing a new conversation (reset synchronously)
    ownUrlId.current = null;
    resetView(routeId); // the draft text is kept on purpose
  }, [routeId, activeId, resetView]);

  const refreshLists = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["conversations"] }),
      qc.invalidateQueries({ queryKey: ["conversation"] }),
      qc.invalidateQueries({ queryKey: ["dashboard"] }),
      qc.invalidateQueries({ queryKey: ["documents"] }),
    ]);
  }, [qc]);

  // Settle a finished / failed / stopped stream: adopt the saved conversation, refetch it, then drop the transient state.
  useEffect(() => {
    if (state.phase !== "idle") return;
    const settled = !!state.final || !!state.error?.messageId || stopRequested.current;
    if (!settled || !state.conversationId) return;
    const id = state.conversationId;
    const gotFinal = !!state.final;
    stopRequested.current = false;
    (async () => {
      if (id !== activeId) {
        setActiveId(id);
        scopeLoadedFor.current = id;
        ownUrlId.current = id;
        window.history.replaceState(null, "", `/chat/${id}`);
      }
      await refreshLists();
      reset();
      if (gotFinal && !state.final?.retrieval_meta?.insufficient_evidence) {
        postJson<FollowUps>(`/conversations/${id}/followups`)
          .then((r) => setFollowups(r.suggestions))
          .catch(() => {});
      }
    })();
  }, [state, activeId, refreshLists, reset]);

  const streaming = state.phase === "streaming";
  const regenerating = streaming && state.question === null;
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  const visible = regenerating && lastUserIdx >= 0 ? messages.slice(0, lastUserIdx + 1) : messages;
  const finalShown = state.final && !messages.some((m) => m.id === state.final!.id) ? state.final : null;
  const pendingQuestionShown = state.question && !messages.some((m) => m.id === state.userMessageId);

  // Auto-scroll while the user is at the bottom.
  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length, state.text, state.sources.length, finalShown]);

  const submit = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q || streaming) return;
      setInput("");
      setFollowups([]);
      stick.current = true;
      lastRequest.current = { question: q };
      stopRequested.current = false;
      send({ question: q, conversation_id: activeId, document_ids: scope.documentIds, collection_id: scope.collectionId, mode });
    },
    [activeId, mode, scope, send, streaming],
  );

  const onRegenerate = useCallback(() => {
    if (!activeId || streaming) return;
    setFollowups([]);
    stick.current = true;
    stopRequested.current = false;
    regenerate(activeId);
  }, [activeId, regenerate, streaming]);

  async function changeScope(next: Scope) {
    setScope(next);
    if (activeId) {
      try {
        await api(`/conversations/${activeId}`, { method: "PATCH", body: { document_ids: next.documentIds, collection_id: next.kind === "collection" ? next.collectionId : null } });
        qc.invalidateQueries({ queryKey: ["conversations"] });
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not update the scope");
      }
    }
  }

  const empty = !activeId && !streaming && !state.question;
  const error = state.error && !state.error.messageId ? state.error : null;
  const title = conv.data?.title ?? "New conversation";
  const canSend = input.trim().length > 0 && !streaming;

  return (
    <div className="flex h-full min-h-0">
      {listInline && (
        <aside className="w-72 shrink-0 border-r p-3" aria-label="Conversations">
          <ConversationList activeId={activeId} onNew={() => resetView(null)} onDeleted={(id) => id === activeId && router.push("/chat")} />
        </aside>
      )}
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-2 md:px-4">
          <Button variant="outline" size="sm" className={cn(listInline && "hidden")} onClick={() => setListOpen(true)} data-testid="open-conversations">
            <List aria-hidden /> Chats
          </Button>
          <h1 className="min-w-0 max-w-[60%] flex-1 truncate text-sm font-semibold sm:max-w-[40%] sm:flex-none" data-testid="conversation-heading">
            {title}
          </h1>
          <div className="-mx-1 flex w-full items-center gap-2 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:ml-auto sm:w-auto sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0">
            <ScopePicker scope={scope} onChange={changeScope} />
            <NativeSelect aria-label="Answer mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} data-testid="mode-select">
              <option value="qa">{"Q&A"}</option>
              <option value="research">Research brief</option>
              <option value="synthesis">Multi-document synthesis</option>
            </NativeSelect>
            <ReopenViewerButton />
            {activeId && (
              <Button variant="outline" size="sm" onClick={() => downloadFromApi(`/conversations/${activeId}/export`, "conversation.md").catch(() => toast.error("Export failed"))} data-testid="export-conversation">
                <Download aria-hidden /> Export
              </Button>
            )}
          </div>
        </div>

        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
          data-testid="thread"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {conv.isLoading && activeId && <Skeleton className="h-32 rounded-2xl" />}
            {conv.error && <ErrorState error={conv.error} onRetry={() => conv.refetch()} />}
            {empty && (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="size-6 text-primary" aria-hidden />
                </div>
                <h2 className="text-lg font-semibold">Ask your documents anything</h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">Answers are grounded in your uploads and cite the exact passages they rely on.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {STARTERS.map((s) => (
                    <Button key={s} variant="outline" size="sm" onClick={() => submit(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {visible.map((m, i) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={m.content} />
              ) : (
                <AssistantBubble key={m.id} message={m} isLast={i === visible.length - 1} disabled={streaming} onRegenerate={onRegenerate} onSave={setSaveMsg} />
              ),
            )}
            {pendingQuestionShown && <UserBubble text={state.question!} />}
            {streaming && <StreamingBubble text={state.text} sources={state.sources} waiting={!state.sources.length} />}
            {finalShown && <AssistantBubble message={finalShown} isLast disabled onRegenerate={onRegenerate} onSave={setSaveMsg} />}
            {error && (
              <ChatErrorCard
                code={error.code}
                message={error.message}
                onRetry={() => {
                  const req = lastRequest.current;
                  reset();
                  if (error.code === "network_error" && activeId) onRegenerate();
                  else if (req) submit(req.question);
                }}
              />
            )}
            {followups.length > 0 && !streaming && (
              <div className="flex flex-wrap gap-2" data-testid="followups" aria-label="Suggested follow-up questions">
                {followups.map((f) => (
                  <Button key={f} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => submit(f)} data-testid="followup-chip">
                    <Sparkles className="text-primary" aria-hidden /> {f}
                  </Button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <form
          className="border-t bg-background px-3 py-3 md:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              placeholder="Ask about your documents…"
              aria-label="Your question (Enter to send, Shift+Enter for a new line)"
              rows={2}
              maxLength={8000}
              className="max-h-40 min-h-12 resize-none"
              data-testid="chat-input"
            />
            {streaming ? (
              <Button
                type="button"
                variant="destructive"
                size="icon-lg"
                aria-label="Stop generating"
                onClick={() => {
                  stopRequested.current = true;
                  stop();
                }}
                data-testid="chat-stop"
              >
                <Square aria-hidden />
              </Button>
            ) : (
              <Button type="submit" size="icon-lg" aria-label="Send" disabled={!canSend} data-testid="chat-send">
                <SendHorizontal aria-hidden />
              </Button>
            )}
          </div>
        </form>
      </section>
      <DockedViewer />

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="w-80 max-w-[90vw] p-3 pt-12">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <ConversationList activeId={activeId} onNew={() => resetView(null)} onNavigate={() => setListOpen(false)} onDeleted={(id) => id === activeId && router.push("/chat")} />
        </SheetContent>
      </Sheet>
      <SaveNoteDialog open={!!saveMsg} onOpenChange={(o) => !o && setSaveMsg(null)} defaultTitle={conv.data?.title ?? "Research note"} content={saveMsg?.content ?? ""} sourceMessageId={saveMsg?.id} />
    </div>
  );
}
