"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Laptop, Loader2, Moon, RefreshCw, Sun, XCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { NativeSelect } from "@/components/shared/native-select";
import { PageContainer } from "@/components/shared/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/features/auth/hooks";
import { JobsLog } from "@/features/documents/documents-view";
import { api, ApiError, buildUrl } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { validatePassword } from "@/lib/validation";
import type { ProviderTestOut, Readiness, SettingsOut } from "@/types/api";

import { useSettings, useUpdateSettings } from "./hooks";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

function ProfileTab() {
  const { data: user } = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  useEffect(() => setName(user?.display_name ?? ""), [user]);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api("/auth/me", { method: "PATCH", body: { display_name: name.trim() } }),
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const change = useMutation({
    mutationFn: () => api("/auth/change-password", { method: "POST", body: { current_password: cur, new_password: next } }),
    onSuccess: () => {
      toast.success("Password updated. Other sessions were signed out.");
      setCur("");
      setNext("");
    },
    onError: (e) => setPwError(errMsg(e)),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="display-name">Display name</Label>
              <Input id="display-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="display-name" />
            </div>
            <Button type="submit" disabled={save.isPending || !name.trim()} data-testid="profile-save">
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Changing your password signs out your other sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const v = validatePassword(next);
              setPwError(v);
              if (!v) change.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="cur-pw">Current password</Label>
              <Input id="cur-pw" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New password</Label>
              <Input id="new-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            {pwError && (
              <p role="alert" className="text-sm text-destructive">
                {pwError}
              </p>
            )}
            <Button type="submit" disabled={change.isPending || !cur || !next}>
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderTab({ s }: { s: SettingsOut }) {
  const update = useUpdateSettings();
  const [provider, setProvider] = useState(s.llm_provider);
  const [model, setModel] = useState(s.llm_model);
  const [result, setResult] = useState<ProviderTestOut | null>(null);
  useEffect(() => {
    setProvider(s.llm_provider);
    setModel(s.llm_model);
  }, [s.llm_provider, s.llm_model]);
  const test = useMutation({
    mutationFn: () => api<ProviderTestOut>("/settings/test-provider", { method: "POST", body: { llm_provider: provider, llm_model: model.trim() || null } }),
    onSuccess: setResult,
    onError: (e) => toast.error(errMsg(e)),
  });
  const info = s.providers.find((p) => p.id === provider);
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI provider</CardTitle>
        <CardDescription>
          Choose which model answers your questions. API keys live only in the server&apos;s environment and are never shown here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider</Label>
            <NativeSelect id="provider" className="w-full" value={provider} onChange={(e) => setProvider(e.target.value)} data-testid="provider-select">
              {s.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.configured ? "" : " — not configured on server"}
                </option>
              ))}
            </NativeSelect>
            {info && !info.configured && <p className="text-xs text-amber-700 dark:text-amber-400">This provider has no credentials on the server yet (e.g. GROQ_API_KEY).</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model">Model identifier</Label>
            <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === "ollama" ? "a model from `ollama list`" : provider === "groq" ? "a model id from console.groq.com" : "mock-1"} data-testid="model-input" />
            <p className="text-xs text-muted-foreground">Model names change over time, so none is built in. Enter one your provider currently offers.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { llm_provider: provider as "groq" | "ollama" | "mock", llm_model: model.trim() || null },
                { onSuccess: () => toast.success("Provider settings saved"), onError: (e) => toast.error(errMsg(e)) },
              )
            }
            data-testid="provider-save"
          >
            Save
          </Button>
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending} data-testid="test-provider">
            {test.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Test connection
          </Button>
          <Button
            variant="ghost"
            disabled={update.isPending || !(s.overrides.llm_provider || s.overrides.llm_model)}
            onClick={() => update.mutate({ reset: ["llm_provider", "llm_model"] }, { onSuccess: () => toast.success("Reverted to server defaults") })}
          >
            Reset to server default
          </Button>
        </div>
        {result && (
          <div role="status" data-testid="test-result" className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", result.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/5")}>
            {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
            <div>
              <p className="font-medium">
                {result.ok ? "Connected" : "Connection failed"} · {result.provider}
                {result.model ? ` · ${result.model}` : ""} · {result.latency_ms.toFixed(0)} ms
              </p>
              <p className="text-muted-foreground">{result.detail}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RetrievalTab({ s }: { s: SettingsOut }) {
  const update = useUpdateSettings();
  const [topK, setTopK] = useState(s.top_k);
  const [threshold, setThreshold] = useState(s.score_threshold);
  const [budget, setBudget] = useState(s.context_token_budget);
  const [hybrid, setHybrid] = useState(s.hybrid_search);
  useEffect(() => {
    setTopK(s.top_k);
    setThreshold(s.score_threshold);
    setBudget(s.context_token_budget);
    setHybrid(s.hybrid_search);
  }, [s]);
  const one = (v: number | readonly number[]) => (Array.isArray(v) ? (v as number[])[0] : (v as number));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retrieval</CardTitle>
        <CardDescription>Controls how passages are selected before the model writes an answer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="topk">Passages per answer (top-k): <span data-testid="topk-value">{topK}</span></Label>
          <Slider id="topk" min={1} max={30} step={1} value={[topK]} onValueChange={(v) => setTopK(one(v))} aria-label="Top k" data-testid="topk-slider" />
        </div>
        <div className="space-y-2">
          <Label>Minimum relevance: {threshold.toFixed(2)}</Label>
          <Slider min={0} max={1} step={0.01} value={[threshold]} onValueChange={(v) => setThreshold(one(v))} aria-label="Relevance threshold" />
          <p className="text-xs text-muted-foreground">Passages scoring below this are ignored. Higher = stricter, more “insufficient evidence” answers.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="budget">Context budget (tokens)</Label>
          <Input id="budget" type="number" min={500} max={32000} step={100} className="w-40" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        </div>
        <div className="flex items-center gap-3">
          <Switch id="hybrid" checked={hybrid} onCheckedChange={setHybrid} aria-label="Hybrid search" />
          <Label htmlFor="hybrid" className="font-normal">
            Hybrid search (combine semantic similarity with keyword matching)
          </Label>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={update.isPending || budget < 500 || budget > 32000}
            onClick={() =>
              update.mutate(
                { top_k: topK, score_threshold: Number(threshold.toFixed(2)), context_token_budget: budget, hybrid_search: hybrid },
                { onSuccess: () => toast.success("Retrieval settings saved"), onError: (e) => toast.error(errMsg(e)) },
              )
            }
            data-testid="retrieval-save"
          >
            Save
          </Button>
          <Button variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ reset: ["top_k", "score_threshold", "context_token_budget", "hybrid_search"] }, { onSuccess: () => toast.success("Reverted to server defaults") })}>
            Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AppearanceTab({ s }: { s: SettingsOut }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const update = useUpdateSettings();
  const options = [
    { v: "light", label: "Light", icon: Sun },
    { v: "dark", label: "Dark", icon: Moon },
    { v: "system", label: "System", icon: Laptop },
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Your choice is saved to your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-2">
          {options.map(({ v, label, icon: Icon }) => {
            const active = (mounted ? (theme ?? s.theme) : s.theme) === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`theme-${v}`}
                onClick={() => {
                  setTheme(v);
                  update.mutate({ theme: v }, { onSuccess: () => toast.success(`Theme: ${label}`) });
                }}
                className={cn("flex flex-col items-center gap-1.5 rounded-xl border p-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-primary bg-primary/5" : "hover:bg-muted/60")}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function EmbeddingsTab({ s }: { s: SettingsOut }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const m = useMutation({
    mutationFn: () => api<{ message: string }>("/documents/reprocess-all", { method: "POST", body: {} }),
    onSuccess: (r) => {
      toast.success(r.message);
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows: Array<[string, string]> = [
    ["Embedding provider", s.embedding_provider],
    ["Embedding model", s.embedding_model],
    ["Vector dimension", String(s.embedding_dim)],
    ["Chunk size", `${s.chunk_size_tokens} tokens`],
    ["Chunk overlap", `${s.chunk_overlap_tokens} tokens`],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Embeddings &amp; chunking</CardTitle>
        <CardDescription>
          These are server-wide settings controlled by environment variables (EMBEDDING_PROVIDER, EMBEDDING_MODEL, CHUNK_SIZE_TOKENS, …) because every document must be indexed with the same model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid max-w-lg grid-cols-2 gap-y-2 text-sm" data-testid="embedding-info">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono text-xs break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="rounded-lg border p-3 text-sm">
          <p className="mb-2">After changing these on the server, re-index your documents so existing text uses the new settings.</p>
          <Button variant="outline" onClick={() => setConfirm(true)} data-testid="reindex-all">
            <RefreshCw aria-hidden /> Reindex all documents
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Reindex all documents?" description="Every document is re-extracted, re-chunked and re-embedded in the background. Search keeps using the old index until each document finishes." confirmLabel="Reindex" destructive={false} pending={m.isPending} onConfirm={() => m.mutate()} />
    </Card>
  );
}

function HealthTab() {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: qk.ready,
    queryFn: async () => {
      const res = await fetch(buildUrl("/ready"), { credentials: "same-origin" });
      return (await res.json()) as Readiness; // 503 (degraded) still carries the full report
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>System health</CardTitle>
        <CardDescription>Readiness checks reported by the API. No secrets are included.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="refresh-health">
            <RefreshCw className={cn(isFetching && "animate-spin")} aria-hidden /> Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : (
          <div className="space-y-3" data-testid="health-checks">
            <p className="text-sm">
              Overall: <Badge variant={data.status === "ready" ? "secondary" : "destructive"}>{data.status}</Badge> <span className="text-muted-foreground">API v{data.version}</span>
            </p>
            <ul className="divide-y rounded-lg border">
              {Object.entries(data.checks).map(([name, c]) => {
                const ok = c.ok === undefined ? true : Boolean(c.ok);
                return (
                  <li key={name} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                    {ok ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <XCircle className="size-4 text-destructive" aria-hidden />}
                    <span className="w-28 font-medium capitalize">{name}</span>
                    <span className="text-muted-foreground">
                      {Object.entries(c)
                        .filter(([k]) => k !== "ok")
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsView() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp.get("tab") ?? "provider";
  const { data: s, error, isLoading, refetch } = useSettings();
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Provider, retrieval, appearance and system status." />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !s ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <Tabs value={tab} onValueChange={(v) => router.replace(`/settings?tab=${v}`)}>
          <TabsList className="mb-4 h-auto flex-wrap">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="provider" data-testid="tab-provider">AI provider</TabsTrigger>
            <TabsTrigger value="retrieval" data-testid="tab-retrieval">Retrieval</TabsTrigger>
            <TabsTrigger value="appearance" data-testid="tab-appearance">Appearance</TabsTrigger>
            <TabsTrigger value="embeddings">Embeddings</TabsTrigger>
            <TabsTrigger value="health" data-testid="tab-health">System health</TabsTrigger>
            <TabsTrigger value="logs">Error logs</TabsTrigger>
          </TabsList>
          <TabsContent value="profile"><ProfileTab /></TabsContent>
          <TabsContent value="provider"><ProviderTab s={s} /></TabsContent>
          <TabsContent value="retrieval"><RetrievalTab s={s} /></TabsContent>
          <TabsContent value="appearance"><AppearanceTab s={s} /></TabsContent>
          <TabsContent value="embeddings"><EmbeddingsTab s={s} /></TabsContent>
          <TabsContent value="health"><HealthTab /></TabsContent>
          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <CardTitle>Processing error logs</CardTitle>
                <CardDescription>Document-processing jobs, with failures first if you filter by “Failed”.</CardDescription>
              </CardHeader>
              <CardContent>
                <JobsLog initialStatus="failed" />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}
