"use client";

import { AlertTriangle, BookmarkPlus, Check, ChevronDown, Copy, Info, Loader2, OctagonX, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourcesList } from "@/features/research/task-result";
import { cn } from "@/lib/utils";
import type { MessageOut, SourceOut } from "@/types/api";

import { Markdown } from "./markdown";

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{text}</div>
    </div>
  );
}

function AllSources({ sources }: { sources: SourceOut[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  const ordered = [...sources].sort((a, b) => Number(b.cited) - Number(a.cited));
  return (
    <div className="mt-3 border-t pt-2">
      <button type="button" className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="toggle-sources">
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        All retrieved sources ({sources.length}) · {sources.filter((s) => s.cited).length} cited
      </button>
      {open && (
        <div className="mt-2" data-testid="all-sources">
          <SourcesList sources={ordered} title="Retrieved sources" />
        </div>
      )}
    </div>
  );
}

export function AssistantBubble({
  message,
  isLast,
  disabled,
  onRegenerate,
  onSave,
}: {
  message: MessageOut;
  isLast: boolean;
  disabled?: boolean;
  onRegenerate: () => void;
  onSave: (m: MessageOut) => void;
}) {
  const [copied, setCopied] = useState(false);
  const meta = message.retrieval_meta ?? {};
  const failed = message.status === "error";
  return (
    <div className="flex gap-3" data-testid="assistant-message" data-status={message.status}>
      <div className="min-w-0 max-w-full flex-1 rounded-2xl rounded-tl-md border bg-card px-4 py-3">
        {meta.insufficient_evidence && (
          <div role="status" data-testid="insufficient-banner" className="mb-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <span>No passage in the selected documents was relevant enough, so no sources are cited and the model was not asked to guess.</span>
          </div>
        )}
        {meta.citation_check === "no_citations" && (
          <div role="status" data-testid="no-citations-banner" className="mb-2 flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-600" aria-hidden />
            <span>This answer contains no citations. Treat it as unverified and check the retrieved sources below.</span>
          </div>
        )}
        {failed ? (
          <div role="alert" className="flex items-start gap-2 text-sm text-destructive" data-testid="message-error">
            <OctagonX className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{message.error ?? "The answer could not be generated."}</span>
          </div>
        ) : (
          <Markdown content={message.content} citations={message.citations} />
        )}
        {message.status === "stopped" && (
          <Badge variant="outline" className="mt-2" data-testid="stopped-badge">
            Stopped
          </Badge>
        )}
        <AllSources sources={message.citations} />
        <div className="mt-3 flex flex-wrap items-center gap-1 border-t pt-2">
          {!failed && (
            <>
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  await navigator.clipboard?.writeText(message.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                data-testid="copy-answer"
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => onSave(message)} data-testid="save-note">
                <BookmarkPlus aria-hidden /> Save to notes
              </Button>
            </>
          )}
          {(isLast || failed) && (
            <Button variant={failed ? "outline" : "ghost"} size="xs" disabled={disabled} onClick={onRegenerate} data-testid={failed ? "retry" : "regenerate"}>
              <RefreshCw aria-hidden /> {failed ? "Retry" : "Regenerate"}
            </Button>
          )}
          {message.model && (
            <span className="ml-auto text-xs text-muted-foreground">
              {message.provider} · {message.model}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function StreamingBubble({ text, sources, waiting }: { text: string; sources: SourceOut[]; waiting: boolean }) {
  return (
    <div className="flex gap-3" data-testid="assistant-message" data-status="streaming" aria-live="polite" aria-busy="true">
      <div className="min-w-0 max-w-full flex-1 rounded-2xl rounded-tl-md border bg-card px-4 py-3">
        <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="retrieval-status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {sources.length ? `Retrieved ${sources.length} source${sources.length > 1 ? "s" : ""} — writing answer…` : waiting ? "Searching your documents…" : "Working…"}
        </p>
        {text && <Markdown content={text} citations={sources} />}
      </div>
    </div>
  );
}
