"use client";

import { useMutation } from "@tanstack/react-query";
import { GitCompare, ListChecks, MessageCircleQuestion, Scale, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { NativeSelect } from "@/components/shared/native-select";
import { PageContainer } from "@/components/shared/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocMultiSelect } from "@/features/documents/doc-multi-select";
import { useReadyDocuments } from "@/features/documents/hooks";
import { api, ApiError } from "@/lib/api";
import type { TaskName, TaskResponse } from "@/types/api";

import { TaskResult } from "./task-result";

const TOOLS: Array<{ name: TaskName; label: string; icon: React.ElementType; blurb: string; multi: boolean }> = [
  { name: "summarize", label: "Summarize", icon: Sparkles, blurb: "Summarize one document with citations.", multi: false },
  { name: "questions", label: "Questions", icon: MessageCircleQuestion, blurb: "Generate research questions a document raises or leaves open.", multi: false },
  { name: "findings", label: "Key findings", icon: ListChecks, blurb: "Extract research question, methods, findings, results, limitations and conclusions.", multi: false },
  { name: "compare", label: "Compare", icon: GitCompare, blurb: "Compare 2 or more documents: agreements, contradictions and differences, with evidence.", multi: true },
  { name: "conflicts", label: "Conflicts", icon: Scale, blurb: "Find claims where documents disagree. Each conflict cites the passage on both sides so you can judge it yourself.", multi: true },
];

function Tool({ tool }: { tool: (typeof TOOLS)[number] }) {
  const { data: ready } = useReadyDocuments();
  const [docs, setDocs] = useState<string[]>([]);
  const [focus, setFocus] = useState("");
  const [length, setLength] = useState<"short" | "medium" | "detailed">("medium");
  const [count, setCount] = useState(6);
  const [out, setOut] = useState<{ r: TaskResponse; title: string } | null>(null);

  const m = useMutation({
    mutationFn: () => api<TaskResponse>(`/research/${tool.name}`, { method: "POST", body: { document_ids: docs, focus: focus.trim() || null, length, count } }),
    onSuccess: (r) => {
      const names = docs.map((id) => ready?.items.find((d) => d.id === id)?.title ?? "document");
      setOut({ r, title: `${tool.label}: ${names.join(" vs ")}` });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Task failed"),
  });
  const valid = tool.multi ? docs.length >= 2 : docs.length === 1;
  const hint = tool.multi ? "Select at least two documents." : "Select one document.";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{tool.blurb}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>{tool.multi ? "Documents" : "Document"}</Label>
          <div>
            <DocMultiSelect value={docs} onChange={(ids) => setDocs(tool.multi ? ids : ids.slice(-1))} max={tool.multi ? 20 : 1} testId={`research-docs-${tool.name}`} placeholder={tool.multi ? "Select documents" : "Select a document"} />
          </div>
        </div>
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor={`focus-${tool.name}`}>Focus (optional)</Label>
          <Input id={`focus-${tool.name}`} value={focus} maxLength={500} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. training methodology" />
        </div>
        {tool.name === "summarize" && (
          <div className="space-y-1.5">
            <Label htmlFor="len">Length</Label>
            <NativeSelect id="len" value={length} onChange={(e) => setLength(e.target.value as typeof length)}>
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="detailed">Detailed</option>
            </NativeSelect>
          </div>
        )}
        {tool.name === "questions" && (
          <div className="space-y-1.5">
            <Label htmlFor="cnt">How many</Label>
            <Input id="cnt" type="number" min={1} max={15} value={count} className="w-20" onChange={(e) => setCount(Math.min(15, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
        )}
        <Button disabled={!valid || m.isPending} onClick={() => m.mutate()} data-testid={`run-${tool.name}`}>
          <tool.icon aria-hidden /> {m.isPending ? "Working…" : `Run ${tool.label.toLowerCase()}`}
        </Button>
      </div>
      {!valid && <p className="text-xs text-muted-foreground">{hint}</p>}
      {m.isPending ? <Skeleton className="h-48 rounded-xl" /> : out && <TaskResult result={out.r} title={out.title} />}
    </div>
  );
}

export function ResearchView() {
  return (
    <PageContainer>
      <PageHeader title="Research tools" description="One-click analyses over your documents. Every claim carries citations you can open and verify." />
      <Tabs defaultValue="summarize">
        <TabsList className="mb-4 flex-wrap">
          {TOOLS.map((t) => (
            <TabsTrigger key={t.name} value={t.name} data-testid={`tab-${t.name}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TOOLS.map((t) => (
          <TabsContent key={t.name} value={t.name}>
            <Tool tool={t} />
          </TabsContent>
        ))}
      </Tabs>
    </PageContainer>
  );
}
