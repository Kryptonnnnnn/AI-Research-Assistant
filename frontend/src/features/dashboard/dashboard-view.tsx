"use client";

import { useQuery } from "@tanstack/react-query";
import { BookMarked, FileText, FolderOpen, HardDrive, MessageSquare, Search, TableIcon, BarChart3, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PageContainer } from "@/components/shared/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { Dashboard } from "@/types/api";

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
        <Icon className="size-4 text-muted-foreground" aria-hidden />
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
  const { data, error, isLoading, refetch } = useQuery({ queryKey: qk.dashboard, queryFn: () => api<Dashboard>("/dashboard") });

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Live numbers from your own workspace."
        actions={
          <Link href="/documents" className={buttonVariants({ variant: "default" })}>
            <Upload aria-hidden /> Upload documents
          </Link>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Documents" value={data.documents.total} icon={FileText} testId="stat-documents" hint={`${data.documents.ready} ready · ${data.documents.processing} processing · ${data.documents.failed} failed`} />
            <Stat label="Conversations" value={data.conversations} icon={MessageSquare} testId="stat-conversations" hint={`${data.questions_asked} questions asked`} />
            <Stat label="Storage used" value={formatBytes(data.storage_bytes)} icon={HardDrive} testId="stat-storage" hint="Original uploaded files" />
            <Stat label="Notes · Collections" value={`${data.notes} · ${data.collections}`} icon={BookMarked} testId="stat-notes" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3" data-testid="doc-status-breakdown">
            <Stat label="Processed" value={data.documents.ready} icon={FileText} testId="stat-ready" />
            <Stat label="Processing" value={data.documents.processing} icon={FileText} testId="stat-processing" />
            <Stat label="Failed" value={data.documents.failed} icon={FileText} testId="stat-failed" />
          </div>
          {data.documents.total === 0 && (
            <EmptyState icon={Upload} title="Your library is empty" description="Upload a PDF, Word, text or Markdown file to start asking questions." action={<Link href="/documents" className={buttonVariants()}>Upload your first document</Link>} />
          )}
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
            <Link href="/search" className="inline-flex items-center gap-1 hover:text-primary"><Search className="size-3.5" aria-hidden />Semantic search</Link>
            <span aria-hidden>·</span>
            <Link href="/collections" className="inline-flex items-center gap-1 hover:text-primary"><FolderOpen className="size-3.5" aria-hidden />Collections</Link>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
