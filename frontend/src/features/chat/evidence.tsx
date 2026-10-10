"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, PanelRightOpen, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { api } from "@/lib/api";
import { splitAroundExcerpt } from "@/lib/highlight";
import { cn } from "@/lib/utils";
import type { ChunkOut, SourceOut } from "@/types/api";

interface EvidenceCtx {
  /** Open the viewer on a source; `group` is the set of sources to step through with prev/next. */
  open: (s: SourceOut, group?: SourceOut[]) => void;
  close: () => void;
  reopen: () => void;
  step: (delta: number) => void;
  source: SourceOut | null;
  group: SourceOut[];
  isOpen: boolean;
  /** True when a docked host (chat page) is mounted and the screen is wide enough to dock the pane. */
  docked: boolean;
  registerDock: () => () => void;
}
const noop = () => {};
const Ctx = createContext<EvidenceCtx>({
  open: noop,
  close: noop,
  reopen: noop,
  step: noop,
  source: null,
  group: [],
  isOpen: false,
  docked: false,
  registerDock: () => noop,
});
export const useEvidence = () => useContext(Ctx);

/** Chat pages call this so the viewer docks beside the answer instead of covering it. */
export function useRegisterDock() {
  const { registerDock } = useEvidence();
  useEffect(() => registerDock(), [registerDock]);
}

export function EvidenceProvider({ children }: { children: React.ReactNode }) {
  const [source, setSource] = useState<SourceOut | null>(null);
  const [group, setGroup] = useState<SourceOut[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [docks, setDocks] = useState(0);
  const wide = useMediaQuery("(min-width: 1280px)");
  const docked = docks > 0 && wide;

  const open = useCallback((s: SourceOut, g?: SourceOut[]) => {
    setSource(s);
    setGroup(g && g.length ? g : [s]);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const reopen = useCallback(() => setOpen(true), []);
  const registerDock = useCallback(() => {
    setDocks((n) => n + 1);
    return () => setDocks((n) => n - 1);
  }, []);
  const step = useCallback(
    (delta: number) => {
      setSource((cur) => {
        if (!cur || group.length < 2) return cur;
        const i = Math.max(
          0,
          group.findIndex((g) => g.label === cur.label && g.chunk_id === cur.chunk_id),
        );
        return group[(i + delta + group.length) % group.length];
      });
    },
    [group],
  );

  const value = useMemo(
    () => ({ open, close, reopen, step, source, group, isOpen, docked, registerDock }),
    [open, close, reopen, step, source, group, isOpen, docked, registerDock],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {!docked && (
        <Sheet open={isOpen} onOpenChange={setOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl" showCloseButton={false} data-testid="evidence-panel">
            <SheetTitle className="sr-only">Source viewer</SheetTitle>
            <SheetDescription className="sr-only">The cited passage and the original document.</SheetDescription>
            {source && <ViewerPane source={source} group={group} onStep={step} onClose={close} />}
          </SheetContent>
        </Sheet>
      )}
    </Ctx.Provider>
  );
}

/** The docked (desktop) host: resizable, collapsible right pane rendered inside the chat layout. */
export function DockedViewer() {
  const { source, group, isOpen, docked, step, close } = useEvidence();
  const { width, min, max, handleProps } = useResizableWidth("ara.viewer.width", 460, 340, 760);
  if (!docked || !isOpen || !source) return null;
  return (
    <aside className="relative flex shrink-0 flex-col border-l bg-background" style={{ width }} data-testid="evidence-panel" aria-label="Source viewer">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize viewer (use left and right arrow keys)"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={width}
        tabIndex={0}
        data-testid="viewer-resize"
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none transition-colors hover:bg-primary/30 focus-visible:bg-primary/50"
        {...handleProps}
      />
      <ViewerPane source={source} group={group} onStep={step} onClose={close} />
    </aside>
  );
}

/** Button for the chat toolbar that brings a collapsed viewer back. */
export function ReopenViewerButton() {
  const { source, isOpen, reopen } = useEvidence();
  if (!source || isOpen) return null;
  return (
    <Button variant="outline" size="sm" onClick={reopen} data-testid="reopen-viewer">
      <PanelRightOpen aria-hidden /> Source viewer
    </Button>
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

function EvidenceHeader({ source }: { source: SourceOut }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{source.label}</Badge>
        <h2 className="truncate text-base font-semibold">{source.document_title}</h2>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {source.page_number ? `Page ${source.page_number}` : "No page information"}
        {source.section ? ` · ${source.section}` : ""}
      </p>
    </div>
  );
}

function EvidenceSections({ source, onNavigate }: { source: SourceOut; onNavigate?: () => void }) {
  const href = viewerHref(source);
  return (
    <div className="space-y-5">
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
          <ExternalLink aria-hidden /> Open full viewer
        </Link>
      ) : (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="viewer-unavailable">
          <FileText className="mr-1.5 inline size-4" aria-hidden />
          The original document was deleted, so it can&apos;t be opened. The excerpt above is a saved snapshot.
        </div>
      )}
    </div>
  );
}

/** Header + evidence sections in one block (used by tests and anywhere a plain evidence card is needed). */
export function EvidenceBody({ source, onNavigate }: { source: SourceOut; onNavigate?: () => void }) {
  return (
    <div className="space-y-4 p-4">
      <EvidenceHeader source={source} />
      <EvidenceSections source={source} onNavigate={onNavigate} />
    </div>
  );
}

const NEIGHBOURS = 2;

/** "Document" tab: the PDF at the cited page, or the extracted text around the cited chunk with the passage highlighted. */
export function DocumentTab({ source }: { source: SourceOut }) {
  const docId = source.document_id;
  const meta = useQuery({
    queryKey: ["document", docId],
    enabled: !!docId,
    queryFn: () => api<{ file_ext: string }>(`/documents/${docId}`),
    staleTime: 60_000,
  });
  const offset = Math.max(0, (source.chunk_index ?? 0) - NEIGHBOURS);
  const isPdfDoc = meta.data?.file_ext === ".pdf";
  const chunks = useQuery({
    queryKey: ["chunks-window", docId, offset],
    enabled: !!docId && meta.isSuccess && !isPdfDoc,
    queryFn: () => api<ChunkOut[]>(`/documents/${docId}/chunks`, { query: { limit: NEIGHBOURS * 2 + 1, offset } }),
  });

  if (!docId) {
    return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">The original document was deleted. Only the saved excerpt (Evidence tab) remains.</p>;
  }
  if (meta.isLoading) return <Skeleton className="h-64 rounded-lg" />;
  if (meta.error) return <p className="text-sm text-destructive">Could not load the document.</p>;
  if (isPdfDoc) {
    const src = `/api/v1/documents/${docId}/file${source.page_number ? `#page=${source.page_number}` : ""}`;
    return (
      <div className="flex h-full min-h-[60vh] flex-col gap-2">
        <p className="rounded-md border-l-4 border-primary bg-muted/50 px-3 py-2 text-xs" data-testid="pane-excerpt">
          <span className="font-medium">Cited passage{source.page_number ? ` (page ${source.page_number})` : ""}:</span> {source.excerpt}
        </p>
        <iframe title={`PDF: ${source.document_title}`} src={src} key={src} data-testid="pane-pdf-frame" className="min-h-[55vh] w-full flex-1 rounded-lg border bg-muted" />
      </div>
    );
  }
  if (chunks.isLoading) return <Skeleton className="h-64 rounded-lg" />;
  return (
    <div className="space-y-3" data-testid="pane-text">
      {chunks.data?.map((c) => {
        const active = c.id === source.chunk_id;
        return (
          <div key={c.id} data-testid="pane-chunk" data-active={active || undefined} className={cn("rounded-lg border p-3 text-sm leading-relaxed", active && "border-primary ring-2 ring-primary/30")}>
            <p className="mb-1 text-xs text-muted-foreground">
              Chunk {c.chunk_index}
              {c.section ? ` · ${c.section}` : ""} {active && <Badge className="ml-1">Cited passage</Badge>}
            </p>
            <p className="whitespace-pre-wrap">{active ? <HighlightedChunk text={c.text} excerpt={source.excerpt} /> : c.text}</p>
          </div>
        );
      })}
    </div>
  );
}

/** The viewer's content: header with prev/next across the answer's citations, then Evidence | Document tabs. */
export function ViewerPane({ source, group, onStep, onClose }: { source: SourceOut; group: SourceOut[]; onStep: (delta: number) => void; onClose: () => void }) {
  const index = Math.max(
    0,
    group.findIndex((g) => g.label === source.label && g.chunk_id === source.chunk_id),
  );
  const multiple = group.length > 1;
  const [tab, setTab] = useState("evidence");
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="viewer-pane">
      <div className="flex items-start gap-2 border-b p-3">
        <EvidenceHeader source={source} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {multiple && (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Previous citation" onClick={() => onStep(-1)} data-testid="viewer-prev">
                <ChevronLeft aria-hidden />
              </Button>
              <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground" data-testid="viewer-position" aria-live="polite">
                {index + 1} of {group.length}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next citation" onClick={() => onStep(1)} data-testid="viewer-next">
                <ChevronRight aria-hidden />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close viewer" onClick={onClose} data-testid="viewer-close">
            <X aria-hidden />
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-3 mt-3 self-start">
          <TabsTrigger value="evidence" data-testid="viewer-tab-evidence">
            Evidence
          </TabsTrigger>
          <TabsTrigger value="document" data-testid="viewer-tab-document">
            Document
          </TabsTrigger>
        </TabsList>
        <TabsContent value="evidence" className="min-h-0 flex-1 overflow-y-auto p-4">
          <EvidenceSections source={source} onNavigate={onClose} />
        </TabsContent>
        <TabsContent value="document" className="min-h-0 flex-1 overflow-y-auto p-4">
          <DocumentTab source={source} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
