"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, BookMarked, CheckCircle2, FileText, FolderOpen, HardDrive, Loader2, MessageSquare, Plus, RefreshCw, Search, TableIcon, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PageContainer } from "@/components/shared/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useReprocess } from "@/features/documents/document-dialogs";
import { FileTile } from "@/features/documents/file-tile";
import { StatusBadge } from "@/features/documents/status-badge";
import { api } from "@/lib/api";
import { formatBytes, stageLabel, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Dashboard, JobOut, Page } from "@/types/api";

import { useDashboard } from "./hooks";

function Stat({ label, value, icon: Icon, hint, testId }: { label: string; value: React.ReactNode; icon: React.ElementType; hint?: string; testId: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight" data-testid={testId}>
            {value}
          </p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}

/** Ready / processing / failed as one proportional bar. Numbers are real; an empty library renders nothing. */
function LibraryHealth({ docs }: { docs: Dashboard["documents"] }) {
  const items = [
    { key: "ready", label: "Processed", n: docs.ready, color: "var(--chart-3)", testId: "stat-ready" },
    { key: "processing", label: "Processing", n: docs.processing, color: "var(--chart-1)", testId: "stat-processing" },
    { key: "failed", label: "Failed", n: docs.failed, color: "var(--destructive)", testId: "stat-failed" },
  ];
  return (
    <Card size="sm" data-testid="doc-status-breakdown">
      <CardContent className="space-y-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${docs.ready} processed, ${docs.processing} processing, ${docs.failed} failed`}>
          {docs.total > 0 && items.map((i) => i.n > 0 && <div key={i.key} style={{ width: `${(i.n / docs.total) * 100}%`, background: i.color }} />)}
        </div>
        <dl className="grid grid-cols-3 gap-3">
          {items.map((i) => (
            <div key={i.key}>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: i.color }} aria-hidden />
                {i.label}
              </dt>
              <dd className="text-xl font-semibold tabular-nums" data-testid={i.testId}>
                {i.n}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function IndexHealthBanner({ stale, signature }: { stale: number; signature: string }) {
  if (stale <= 0) return null;
  return (
    <div role="status" data-testid="index-health-banner" className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber-700 dark:text-amber-400" aria-hidden />
      <div>
        <p className="font-medium">
          {stale} document{stale > 1 ? "s are" : " is"} being re-indexed
        </p>
        <p className="text-muted-foreground">
          The embedding model or chunking settings changed, so these documents are rebuilt for the current index (<code className="text-xs">{signature}</code>). Search quality is reduced until they finish.
        </p>
      </div>
    </div>
  );
}

function RecentDocuments({ docs }: { docs: NonNullable<Dashboard["recent_documents"]> }) {
  return (
    <Card data-testid="recent-documents">
      <CardHeader>
        <CardTitle>Recent documents</CardTitle>
        <CardAction>
          <Link href="/documents" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            View library
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <EmptyState icon={Upload} title="No documents yet" description="Upload a PDF, Word, text or Markdown file to start asking questions." action={<Link href="/documents" className={buttonVariants()}>Upload your first document</Link>} />
        ) : (
          <ul className="divide-y">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5" data-testid="recent-document" data-status={d.status}>
                <FileTile ext={d.file_ext} />
                <div className="min-w-0 flex-1">
                  <Link href={`/documents/${d.id}`} className="block truncate text-sm font-medium hover:text-primary">
                    {d.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(d.size_bytes)}
                    {d.page_count != null ? ` · ${d.page_count} pages` : ""} · {timeAgo(d.created_at)}
                  </p>
                </div>
                <StatusBadge doc={d} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProcessingActivity({ jobs, failedDocs }: { jobs: NonNullable<Dashboard["active_jobs"]>; failedDocs: number }) {
  const reprocess = useReprocess();
  const failed = useQuery({
    queryKey: ["jobs", { status: "failed", page_size: 3, dashboard: true }],
    queryFn: () => api<Page<JobOut>>("/jobs", { query: { status: "failed", page_size: 3 } }),
    enabled: failedDocs > 0,
  });
  const idle = jobs.length === 0 && !(failed.data?.items.length ?? 0);
  return (
    <Card data-testid="processing-activity">
      <CardHeader>
        <CardTitle>Processing activity</CardTitle>
        <CardDescription>Documents being indexed right now, and recent failures.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {idle && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="processing-idle">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> Nothing is processing. Uploads appear here while they are indexed.
          </p>
        )}
        {jobs.length > 0 && (
          <ul className="space-y-3" aria-label="Active jobs">
            {jobs.map((j) => (
              <li key={j.id} data-testid="active-job">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/documents/${j.document_id}`} className="truncate font-medium hover:text-primary">
                    {j.document_title}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{j.progress}%</span>
                </div>
                <Progress value={j.progress} aria-label={`Progress for ${j.document_title}`} className="mt-1 h-1.5" />
                <p className="mt-1 text-xs text-muted-foreground">
                  {j.status === "queued" ? "Queued" : stageLabel(j.stage)}
                  {j.attempts > 1 ? ` · attempt ${j.attempts}/${j.max_attempts}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {(failed.data?.items.length ?? 0) > 0 && (
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-destructive uppercase">
              <AlertTriangle className="size-3.5" aria-hidden /> Failed
            </h4>
            <ul className="space-y-2">
              {failed.data!.items.map((j) => (
                <li key={j.id} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm" data-testid="failed-job">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/documents/${j.document_id}`} className="min-w-0 truncate font-medium hover:text-primary">
                      {j.document_title ?? j.document_id}
                    </Link>
                    <Button size="xs" variant="outline" onClick={() => reprocess.mutate(j.document_id)} disabled={reprocess.isPending}>
                      <RefreshCw aria-hidden /> Retry
                    </Button>
                  </div>
                  {j.error_message && <p className="mt-1 text-xs text-muted-foreground">{j.error_message}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityChart({ data }: { data: Dashboard["queries_last_14_days"] }) {
  const [table, setTable] = useState(false);
  const total = data.reduce((s, d) => s + d.count, 0);
  const short = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Query activity · last 14 days</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? <BarChart3 aria-hidden /> : <TableIcon aria-hidden />} {table ? "Chart" : "Table"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No questions or searches yet. Activity will appear here once you start asking.</p>
        ) : table ? (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Date</th>
                  <th className="py-1 text-right font-medium">Queries</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.date} className="border-t">
                    <td className="py-1">{short(d.date)}</td>
                    <td className="py-1 text-right tabular-nums">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-56 w-full" role="img" aria-label={`Bar chart of queries per day, ${total} in total`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" tickFormatter={short} tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
                  labelFormatter={(d) => short(String(d))}
                  formatter={(v) => [String(v), "Queries"]}
                />
                <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const KIND_LABEL: Record<string, string> = { chat: "Chat questions", search: "Semantic searches", research: "Research tasks" };
const KIND_COLOR: Record<string, string> = { chat: "var(--chart-1)", search: "var(--chart-2)", research: "var(--chart-3)" };

export function DashboardView() {
  const { data, error, isLoading, refetch } = useDashboard();

  return (
    <PageContainer wide>
      <PageHeader
        title="Dashboard"
        description="Live numbers from your own workspace."
        actions={
          <>
            <Link href="/chat" className={buttonVariants({ variant: "outline" })}>
              <Plus aria-hidden /> New chat
            </Link>
            <Link href="/documents" className={buttonVariants({ variant: "default" })}>
              <Upload aria-hidden /> Upload documents
            </Link>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4">
          <IndexHealthBanner stale={data.index_health?.stale_documents ?? 0} signature={data.index_health?.current_signature ?? ""} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Documents" value={data.documents.total} icon={FileText} testId="stat-documents" hint={`${data.documents.ready} ready · ${data.documents.processing} processing · ${data.documents.failed} failed`} />
            <Stat label="Conversations" value={data.conversations} icon={MessageSquare} testId="stat-conversations" hint={`${data.questions_asked} questions asked`} />
            <Stat label="Storage used" value={formatBytes(data.storage_bytes)} icon={HardDrive} testId="stat-storage" hint="Original uploaded files" />
            <Stat label="Notes · Collections" value={`${data.notes} · ${data.collections}`} icon={BookMarked} testId="stat-notes" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <LibraryHealth docs={data.documents} />
              <RecentDocuments docs={data.recent_documents ?? []} />
            </div>
            <ProcessingActivity jobs={data.active_jobs ?? []} failedDocs={data.documents.failed} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ActivityChart data={data.queries_last_14_days} />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Activity by type</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(data.queries_by_kind).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing yet.</p>
                ) : (
                  Object.entries(data.queries_by_kind).map(([k, n]) => {
                    const max = Math.max(...Object.values(data.queries_by_kind));
                    return (
                      <div key={k}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span>{KIND_LABEL[k] ?? k}</span>
                          <span className="tabular-nums text-muted-foreground">{n}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div className="h-2 rounded-full" style={{ width: `${(n / max) * 100}%`, background: KIND_COLOR[k] ?? "var(--chart-4)" }} />
                        </div>
                      </div>
                    );
                  })
                )}
                <p className="border-t pt-3 text-xs text-muted-foreground" data-testid="avg-latency">
                  {data.avg_query_latency_ms === null ? "Average latency: no data yet" : `Average latency: ${(data.avg_query_latency_ms / 1000).toFixed(2)} s`}
                </p>
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Most referenced documents</CardTitle>
              </CardHeader>
              <CardContent>
                {data.popular_documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Documents appear here once answers cite them.</p>
                ) : (
                  <ul className="divide-y">
                    {data.popular_documents.map((d) => (
                      <li key={d.id}>
                        <Link href={`/documents/${d.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary">
                          <span className="truncate">{d.title}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{d.access_count} cited</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recent_activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                ) : (
                  <ul className="divide-y">
                    {data.recent_activity.map((a) => (
                      <li key={`${a.type}-${a.id}`}>
                        <Link href={a.type === "document" ? `/documents/${a.id}` : `/chat/${a.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-primary">
                          {a.type === "document" ? <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                          <span className="min-w-0 flex-1 truncate">{a.title}</span>
                          <span className={cn("shrink-0 text-xs text-muted-foreground")}>{timeAgo(a.at)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="flex flex-wrap gap-2 pt-1 text-sm text-muted-foreground">
            <Link href="/search" className="inline-flex items-center gap-1 hover:text-primary">
              <Search className="size-3.5" aria-hidden />
              Semantic search
            </Link>
            <span aria-hidden>·</span>
            <Link href="/collections" className="inline-flex items-center gap-1 hover:text-primary">
              <FolderOpen className="size-3.5" aria-hidden />
              Collections
            </Link>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
