"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileText, FolderPlus, MessageSquare, MoreHorizontal, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { NativeSelect } from "@/components/shared/native-select";
import { PageContainer } from "@/components/shared/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollections } from "@/features/collections/hooks";
import { api, downloadFromApi } from "@/lib/api";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { DocumentOut, JobOut, Page } from "@/types/api";

import { AssignCollectionsDialog, DeleteDocumentDialog, RenameDocumentDialog, useReprocess } from "./document-dialogs";
import { useDocuments } from "./hooks";
import { StatusBadge } from "./status-badge";
import { UploadZone } from "./upload-zone";

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm" data-testid="pager">
      <span className="text-muted-foreground">
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function DocRow({ doc, onRename, onDelete, onAssign }: { doc: DocumentOut; onRename: () => void; onDelete: () => void; onAssign: () => void }) {
  const reprocess = useReprocess();
  const canReprocess = doc.status === "ready" || doc.status === "failed";
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center" data-testid="doc-row" data-status={doc.status}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0">
          <Link href={`/documents/${doc.id}`} className="block truncate font-medium hover:text-primary" data-testid="doc-title">
            {doc.title}
          </Link>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{doc.file_ext.replace(".", "").toUpperCase()}</span>
            <span>{formatBytes(doc.size_bytes)}</span>
            <span>{formatDate(doc.created_at)}</span>
            {doc.page_count != null && <span>{doc.page_count} pages</span>}
            {doc.status === "ready" && <span>{doc.chunk_count} chunks</span>}
          </p>
          {doc.status === "failed" && doc.error_message && (
            <p className="mt-1.5 text-sm text-destructive" role="alert" data-testid="doc-error">
              {doc.error_message}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <StatusBadge doc={doc} />
        {doc.status === "failed" && (
          <Button variant="outline" size="sm" onClick={() => reprocess.mutate(doc.id)} disabled={reprocess.isPending} data-testid="retry-doc">
            <RefreshCw aria-hidden /> Retry
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${doc.title}`} data-testid="doc-actions" />}>
            <MoreHorizontal aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem render={<Link href={`/documents/${doc.id}`} />}>
              <FileText aria-hidden /> Open
            </DropdownMenuItem>
            {doc.status === "ready" && (
              <DropdownMenuItem render={<Link href={`/chat?doc=${doc.id}`} />}>
                <MessageSquare aria-hidden /> Chat with document
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onRename} data-testid="action-rename">
              <Pencil aria-hidden /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAssign}>
              <FolderPlus aria-hidden /> Collections…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canReprocess} onClick={() => reprocess.mutate(doc.id)}>
              <RefreshCw aria-hidden /> Reprocess
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => downloadFromApi(`/documents/${doc.id}/file?download=true`, doc.original_filename).catch(() => toast.error("Download failed"))}>
              <Download aria-hidden /> Download
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete} data-testid="action-delete">
              <Trash2 aria-hidden /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function Library() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [collection, setCollection] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q);
  const { data: collections } = useCollections();
  const { data, error, isLoading, refetch } = useDocuments({ page, q: debouncedQ || undefined, status: status || undefined, sort, collection_id: collection || undefined });
  const [rename, setRename] = useState<DocumentOut | null>(null);
  const [del, setDel] = useState<DocumentOut | null>(null);
  const [assign, setAssign] = useState<DocumentOut | null>(null);
  const reset = (fn: () => void) => () => {
    fn();
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <UploadZone />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search documents"
            placeholder="Search documents…"
            className="pl-8"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            data-testid="doc-search"
          />
        </div>
        <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => reset(() => setStatus(e.target.value))()}>
          <option value="">All statuses</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter by collection" value={collection} onChange={(e) => reset(() => setCollection(e.target.value))()}>
          <option value="">All collections</option>
          {collections?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Sort documents" value={sort} onChange={(e) => reset(() => setSort(e.target.value))()}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="title">Title A–Z</option>
          <option value="size">Largest</option>
          <option value="popular">Most cited</option>
        </NativeSelect>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={q || status || collection ? "No documents match your filters" : "No documents yet"}
          description={q || status || collection ? "Try clearing the search or filters." : "Drop files above to build your research library."}
        />
      ) : (
        <>
          <div className="space-y-3" data-testid="doc-list">
            {data?.items.map((d) => (
              <DocRow key={d.id} doc={d} onRename={() => setRename(d)} onDelete={() => setDel(d)} onAssign={() => setAssign(d)} />
            ))}
          </div>
          {data && <Pager page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
        </>
      )}
      <RenameDocumentDialog doc={rename} onClose={() => setRename(null)} />
      <DeleteDocumentDialog doc={del} onClose={() => setDel(null)} />
      <AssignCollectionsDialog doc={assign} onClose={() => setAssign(null)} />
    </div>
  );
}

export function JobsLog({ initialStatus = "" }: { initialStatus?: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: qk.jobs({ status, page }),
    queryFn: () => api<Page<JobOut>>("/jobs", { query: { status: status || undefined, page, page_size: 15 } }),
    refetchInterval: (q) => (q.state.data?.items.some((j) => j.status === "queued" || j.status === "running") ? 3000 : false),
  });
  const reprocess = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}/reprocess`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Reprocessing started");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <NativeSelect aria-label="Filter jobs by status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">All jobs</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
          <option value="queued">Queued</option>
          <option value="succeeded">Succeeded</option>
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw aria-hidden /> Refresh
        </Button>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={FileText} title="No processing jobs" description={status ? "No jobs with this status." : "Jobs appear here when you upload documents."} />
      ) : (
        <>
          <ul className="divide-y rounded-xl border" data-testid="job-list">
            {data?.items.map((j) => (
              <li key={j.id} className="flex flex-wrap items-start gap-3 p-3 text-sm" data-testid="job-row">
                <div className="min-w-0 flex-1">
                  <Link href={`/documents/${j.document_id}`} className="font-medium hover:text-primary">
                    {j.document_title ?? j.document_id}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(j.created_at)} · attempt {j.attempts}/{j.max_attempts} · {j.stage}
                  </p>
                  {j.error_message && <p className="mt-1 text-destructive">{j.error_message}</p>}
                </div>
                <Badge variant={j.status === "failed" ? "destructive" : j.status === "succeeded" ? "secondary" : "outline"}>{j.status}</Badge>
                {j.status === "failed" && (
                  <Button size="sm" variant="outline" onClick={() => reprocess.mutate(j.document_id)}>
                    <RefreshCw aria-hidden /> Retry
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {data && <Pager page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}

export function DocumentsView() {
  return (
    <PageContainer>
      <PageHeader title="Documents" description="Upload papers and notes. Each file is extracted, chunked, embedded and indexed in the background." />
      <Tabs defaultValue="library">
        <TabsList className="mb-4">
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="log" data-testid="tab-processing-log">Processing log</TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <Library />
        </TabsContent>
        <TabsContent value="log">
          <JobsLog />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
