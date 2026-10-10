"use client";

import { useMutation } from "@tanstack/react-query";
import { MessageSquare, Search as SearchIcon, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { PageContainer } from "@/components/shared/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useEvidence, viewerHref } from "@/features/chat/evidence";
import { ALL_SCOPE, ScopePicker, type Scope } from "@/features/chat/scope-picker";
import { api, ApiError } from "@/lib/api";
import type { SearchResponse } from "@/types/api";

export function SearchView() {
  const evidence = useEvidence();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [advanced, setAdvanced] = useState(false);
  const [topK, setTopK] = useState(10);
  const [threshold, setThreshold] = useState<number | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api<SearchResponse>("/search", {
        method: "POST",
        body: { query: query.trim(), document_ids: scope.documentIds, collection_id: scope.kind === "collection" ? scope.collectionId : null, top_k: topK, score_threshold: threshold },
      }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Search failed"),
  });
  return (
    <PageContainer>
      <PageHeader title="Semantic search" description="Find relevant passages by meaning — no exact keywords needed. Results are scoped to your own documents." />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) m.mutate();
        }}
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input aria-label="Search query" placeholder="e.g. how does the model handle long-range dependencies?" className="h-10 pl-9" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="search-input" />
          </div>
          <Button type="submit" size="lg" disabled={!query.trim() || m.isPending} data-testid="search-submit">
            Search
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopePicker scope={scope} onChange={setScope} />
          <Button type="button" variant="ghost" size="sm" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
            <SlidersHorizontal aria-hidden /> Advanced
          </Button>
        </div>
        {advanced && (
          <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Max results: {topK}</Label>
              <Slider min={1} max={30} step={1} value={[topK]} onValueChange={(v) => setTopK(Array.isArray(v) ? v[0] : v)} aria-label="Maximum results" />
            </div>
            <div className="space-y-2">
              <Label>Min relevance: {threshold === null ? "default" : threshold.toFixed(2)}</Label>
              <Slider min={0} max={1} step={0.05} value={[threshold ?? 0.25]} onValueChange={(v) => setThreshold(Array.isArray(v) ? v[0] : v)} aria-label="Minimum relevance" />
              {threshold !== null && (
                <Button type="button" variant="link" size="xs" onClick={() => setThreshold(null)}>
                  Use my default threshold
                </Button>
              )}
            </div>
          </div>
        )}
      </form>
      <div className="mt-6" aria-live="polite">
        {m.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : m.data ? (
          m.data.results.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No relevant passages found" description="Nothing scored above the relevance threshold. Try different wording, widen the scope, or lower the minimum relevance under Advanced." />
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground" data-testid="search-summary">
                {m.data.results.length} passage{m.data.results.length > 1 ? "s" : ""} · {m.data.candidates} candidates · {m.data.latency_ms.toFixed(0)} ms
              </p>
              <ul className="space-y-3" data-testid="search-results">
                {m.data.results.map((r) => (
                  <li key={r.chunk_id ?? r.label}>
                    <Card size="sm" data-testid="search-result">
                      <CardContent className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{r.document_title}</span>
                          {r.page_number && <Badge variant="secondary">p.{r.page_number}</Badge>}
                          {r.section && <span className="truncate text-xs text-muted-foreground">{r.section}</span>}
                          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                            score {r.score.toFixed(2)} · vec {r.vector_score.toFixed(2)} · kw {r.keyword_score.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed">{r.excerpt}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="xs" onClick={() => evidence.open(r)} data-testid="search-evidence">
                            View evidence
                          </Button>
                          {viewerHref(r) && (
                            <Link href={viewerHref(r)!} className={buttonVariants({ variant: "outline", size: "xs" })}>
                              Open document
                            </Link>
                          )}
                          {r.document_id && (
                            <Link href={`/chat?doc=${r.document_id}&q=${encodeURIComponent(query.trim())}`} className={buttonVariants({ variant: "ghost", size: "xs" })} data-testid="ask-about-this">
                              <MessageSquare aria-hidden /> Ask about this
                            </Link>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : (
          <EmptyState icon={SearchIcon} title="Search by meaning" description="Type a question or topic. We rank passages from your documents using embeddings plus keyword matching." />
        )}
      </div>
    </PageContainer>
  );
}
