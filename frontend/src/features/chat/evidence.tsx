"use client";

import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { splitAroundExcerpt } from "@/lib/highlight";
import { cn } from "@/lib/utils";
import type { SourceOut } from "@/types/api";

interface EvidenceCtx {
  open: (s: SourceOut) => void;
  close: () => void;
}
const Ctx = createContext<EvidenceCtx>({ open: () => {}, close: () => {} });
export const useEvidence = () => useContext(Ctx);

export function EvidenceProvider({ children }: { children: React.ReactNode }) {
  const [source, setSource] = useState<SourceOut | null>(null);
  const [isOpen, setOpen] = useState(false);
  const open = useCallback((s: SourceOut) => {
    setSource(s);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, close }), [open, close]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="evidence-panel">
          {source && <EvidenceBody source={source} onNavigate={close} />}
        </SheetContent>
      </Sheet>
    </Ctx.Provider>
  );
}

export function viewerHref(s: Pick<SourceOut, "document_id" | "page_number" | "chunk_id"> & { excerpt?: string }): string | null {
  if (!s.document_id) return null;
  const qs = new URLSearchParams();
  if (s.page_number) qs.set("page", String(s.page_number));
  if (s.chunk_id) qs.set("chunk", s.chunk_id);
  if (s.excerpt) qs.set("excerpt", s.excerpt.slice(0, 400));
  const q = qs.toString();
  return `/documents/${s.document_id}${q ? `?${q}` : ""}`;
}

export function HighlightedChunk({ text, excerpt }: { text: string; excerpt: string }) {
  const parts = splitAroundExcerpt(text, excerpt);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.before}
      <mark className="excerpt" data-testid="highlighted-excerpt">
        {parts.match}
      </mark>
      {parts.after}
    </>
  );
}

export function EvidenceBody({ source, onNavigate }: { source: SourceOut; onNavigate?: () => void }) {
  const href = viewerHref(source);
  return (
    <>
      <SheetHeader className="border-b pb-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{source.label}</Badge>
          <SheetTitle className="truncate text-base">{source.document_title}</SheetTitle>
        </div>
        <SheetDescription>
          {source.page_number ? `Page ${source.page_number}` : "No page information"}
          {source.section ? ` · ${source.section}` : ""}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6">
        <section aria-labelledby="ev-excerpt">
          <h3 id="ev-excerpt" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Supporting excerpt
          </h3>
          <blockquote className="rounded-lg border-l-4 border-primary bg-muted/50 p-3 text-sm leading-relaxed" data-testid="evidence-excerpt">
            {source.excerpt}
          </blockquote>
        </section>
        <section aria-labelledby="ev-context">
          <h3 id="ev-context" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Full passage (excerpt highlighted)
          </h3>
          <p className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3 text-sm leading-relaxed" data-testid="evidence-chunk">
            <HighlightedChunk text={source.chunk_text} excerpt={source.excerpt} />
          </p>
        </section>
        <section aria-labelledby="ev-meta">
          <h3 id="ev-meta" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Retrieval details
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Relevance score</dt>
            <dd className="tabular-nums">{source.score.toFixed(3)}</dd>
            <dt className="text-muted-foreground">Vector similarity</dt>
            <dd className="tabular-nums">{source.vector_score.toFixed(3)}</dd>
            <dt className="text-muted-foreground">Keyword score</dt>
            <dd className="tabular-nums">{source.keyword_score.toFixed(3)}</dd>
            <dt className="text-muted-foreground">Chunk index</dt>
            <dd className="tabular-nums">{source.chunk_index ?? "—"}</dd>
            <dt className="text-muted-foreground">Chunk id</dt>
            <dd className="truncate font-mono text-xs" title={source.chunk_id ?? undefined}>
              {source.chunk_id ?? "—"}
            </dd>
          </dl>
        </section>
        {href ? (
          <Link href={href} onClick={onNavigate} className={cn(buttonVariants({ variant: "default" }), "w-full")} data-testid="open-in-viewer">
            <ExternalLink aria-hidden /> Open in document viewer
          </Link>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="viewer-unavailable">
            <FileText className="mr-1.5 inline size-4" aria-hidden />
            The original document was deleted, so it can&apos;t be opened. The excerpt above is a saved snapshot.
          </div>
        )}
      </div>
    </>
  );
}
