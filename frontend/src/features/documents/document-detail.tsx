"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Download, FileQuestion, ListChecks, MessageSquare, Pencil, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageContainer } from "@/components/shared/page-container";
import { ErrorState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HighlightedChunk } from "@/features/chat/evidence";
import { TaskResult } from "@/features/research/task-result";
import { api, ApiError, downloadFromApi } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChunkOut, TaskName, TaskResponse } from "@/types/api";

import { DeleteDocumentDialog, RenameDocumentDialog, useReprocess } from "./document-dialogs";
import { useDocument } from "./hooks";
import { StatusBadge } from "./status-badge";

const PAGE = 50;

function TextTab({ docId, page, chunkId, excerpt }: { docId: string; page: number | null; chunkId: string | null; excerpt: string }) {
  const [pageFilter, setPageFilter] = useState<number | null>(page);
  useEffect(() => setPageFilter(page), [page]);
  const q = useInfiniteQuery({
    queryKey: ["chunks", docId, pageFilter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<ChunkOut[]>(`/documents/${docId}/chunks`, { query: { limit: PAGE, offset: pageParam, page_number: pageFilter ?? undefined } }),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
  const chunks = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  const found = chunkId ? chunks.some((c) => c.id === chunkId) : true;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    // Keep loading until the cited chunk is on screen (bounded by the document's size).
    if (chunkId && !found && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [chunkId, found, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (found && chunkId) ref.current?.scrollIntoView({ block: "center" });
  }, [found, chunkId, chunks.length]);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      {pageFilter !== null && (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">Page {pageFilter}</Badge>
          <Button variant="ghost" size="sm" onClick={() => setPageFilter(null)}>
            Show all pages
          </Button>
        </div>
      )}
      {q.isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : chunks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No extracted text{pageFilter !== null ? " on this page" : " yet — the document may still be processing"}.</p>
      ) : (
        chunks.map((c) => {
          const active = c.id === chunkId;
          return (
            <div
              key={c.id}
              ref={active ? ref : undefined}
              data-chunk-id={c.id}
              data-testid="chunk"
              data-active={active || undefined}
              className={cn("rounded-xl border p-4", active && "border-primary ring-2 ring-primary/30")}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Chunk {c.chunk_index}</span>
                {c.page_number && <span>· Page {c.page_number}</span>}
                {c.section && <span className="truncate">· {c.section}</span>}
                {active && <Badge>Cited passage</Badge>}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{active && excerpt ? <HighlightedChunk text={c.text} excerpt={excerpt} /> : c.text}</p>
            </div>
          );
        })
      )}
      {q.hasNextPage && (
        <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

const TASKS: Array<{ name: TaskName; label: string; icon: React.ElementType; title: string }> = [
  { name: "summarize", label: "Summarize", icon: Sparkles, title: "Summary" },
  { name: "questions", label: "Generate questions", icon: FileQuestion, title: "Research questions" },
  { name: "findings", label: "Extract key findings", icon: ListChecks, title: "Key findings" },
];

export function DocumentDetail({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const page = sp.get("page") ? Number(sp.get("page")) : null;
  const chunk = sp.get("chunk");
  const excerpt = sp.get("excerpt") ?? "";
  const { data: doc, error, isLoading, refetch } = useDocument(id);
  const [rename, setRename] = useState(false);
  const [del, setDel] = useState(false);
  const reprocess = useReprocess();
  const [tab, setTab] = useState<string | null>(null);
  const [result, setResult] = useState<{ result: TaskResponse; title: string } | null>(null);

  const task = useMutation({
    mutationFn: ({ name }: { name: TaskName; title: string }) =>
      api<TaskResponse>(`/research/${name}`, { method: "POST", body: { document_ids: [id], length: "medium", count: 6 } }),
    onSuccess: (r, v) => {
      setResult({ result: r, title: `${v.title}: ${doc?.title ?? ""}` });
      setTab("insights");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Task failed"),
  });

  if (error) return <PageContainer><ErrorState error={error} onRetry={() => refetch()} /></PageContainer>;
  if (isLoading || !doc) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-10 w-1/2" />
        <Skeleton className="h-96 rounded-xl" />
      </PageContainer>
    );
  }
  const isPdf = doc.file_ext === ".pdf";
  const activeTab = tab ?? (isPdf ? "viewer" : "text");
  const src = `/api/v1/documents/${doc.id}/file${page ? `#page=${page}` : ""}`;
  const ready = doc.status === "ready";

  return (
    <PageContainer wide>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight" data-testid="doc-detail-title">{doc.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{doc.original_filename}</span>
            <span>{formatBytes(doc.size_bytes)}</span>
            <span>Uploaded {formatDate(doc.created_at)}</span>
            {doc.page_count != null && <span>{doc.page_count} pages</span>}
            <span>{doc.chunk_count} chunks</span>
            <StatusBadge doc={doc} />
          </p>
          {doc.status === "failed" && doc.error_message && <p role="alert" className="mt-2 text-sm text-destructive">{doc.error_message}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/chat?doc=${doc.id}`} aria-disabled={!ready} className={cn(buttonVariants(), !ready && "pointer-events-none opacity-50")} data-testid="chat-with-doc">
            <MessageSquare aria-hidden /> Chat with this document
          </Link>
          <Button variant="outline" size="icon" aria-label="Rename" onClick={() => setRename(true)}><Pencil aria-hidden /></Button>
          <Button variant="outline" size="icon" aria-label="Reprocess" onClick={() => reprocess.mutate(doc.id)} disabled={!(doc.status === "ready" || doc.status === "failed")}><RefreshCw aria-hidden /></Button>
          <Button variant="outline" size="icon" aria-label="Download" onClick={() => downloadFromApi(`/documents/${doc.id}/file?download=true`, doc.original_filename).catch(() => toast.error("Download failed"))}><Download aria-hidden /></Button>
          <Button variant="outline" size="icon" aria-label="Delete" onClick={() => setDel(true)}><Trash2 aria-hidden /></Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TASKS.map((t) => (
          <Button key={t.name} variant="secondary" size="sm" disabled={!ready || task.isPending} onClick={() => task.mutate({ name: t.name, title: t.title })} data-testid={`task-${t.name}`}>
            <t.icon aria-hidden /> {task.isPending && task.variables?.name === t.name ? "Working…" : t.label}
          </Button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="mb-4">
          {isPdf && <TabsTrigger value="viewer" data-testid="tab-viewer">Document</TabsTrigger>}
          <TabsTrigger value="text" data-testid="tab-text">Extracted text</TabsTrigger>
          <TabsTrigger value="insights" data-testid="tab-insights">Insights</TabsTrigger>
        </TabsList>
        {isPdf && (
          <TabsContent value="viewer">
            {chunk && excerpt && (
              <div className="mb-3 rounded-lg border-l-4 border-primary bg-muted/50 p-3 text-sm" data-testid="viewer-excerpt">
                <span className="mr-2 font-medium">Cited passage{page ? ` (page ${page})` : ""}:</span>
                {excerpt}
              </div>
            )}
            <iframe title={`PDF viewer for ${doc.title}`} src={src} key={src} data-testid="pdf-frame" className="h-[75vh] w-full rounded-xl border bg-muted" />
          </TabsContent>
        )}
        <TabsContent value="text">
          <TextTab docId={doc.id} page={page} chunkId={chunk} excerpt={excerpt} />
        </TabsContent>
        <TabsContent value="insights">
          {task.isPending ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : result ? (
            <TaskResult result={result.result} title={result.title} />
          ) : (
            <p className="text-sm text-muted-foreground">Run Summarize, Generate questions or Extract key findings to see results here, with citations back to this document.</p>
          )}
        </TabsContent>
      </Tabs>
      <RenameDocumentDialog doc={rename ? doc : null} onClose={() => setRename(false)} />
      <DeleteDocumentDialog doc={del ? doc : null} onClose={() => setDel(false)} onDeleted={() => router.replace("/documents")} />
    </PageContainer>
  );
}
