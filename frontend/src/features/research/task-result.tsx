"use client";

import { BookmarkPlus, Check, ChevronDown, Copy, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/features/chat/markdown";
import { useEvidence } from "@/features/chat/evidence";
import { SaveNoteDialog } from "@/features/notes/save-note-dialog";
import { saveBlob } from "@/lib/api";
import type { SourceOut, TaskResponse } from "@/types/api";

export function sourcesMarkdown(citations: SourceOut[]): string {
  const cited = citations.filter((c) => c.cited);
  if (!cited.length) return "";
  return (
    "\n\n## Sources\n\n" +
    cited.map((c) => `- **[${c.label}]** ${c.document_title}${c.page_number ? `, p. ${c.page_number}` : ""} — “${c.excerpt.replace(/\n/g, " ")}”`).join("\n") +
    "\n"
  );
}

export function slug(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export") + ".md";
}

export function SourcesList({ sources, title = "Sources" }: { sources: SourceOut[]; title?: string }) {
  const { open } = useEvidence();
  if (!sources.length) return null;
  return (
    <ul className="space-y-1" aria-label={title}>
      {sources.map((s) => (
        <li key={`${s.label}-${s.chunk_id}`}>
          <button
            type="button"
            onClick={() => open(s, sources)}
            className="flex w-full items-start gap-2 rounded-md p-1.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Badge variant={s.cited ? "default" : "outline"}>{s.label}</Badge>
            <span className="min-w-0">
              <span className="font-medium">{s.document_title}</span>
              {s.page_number ? <span className="text-muted-foreground"> · p.{s.page_number}</span> : null}
              <span className="ml-2 text-xs text-muted-foreground tabular-nums">score {s.score.toFixed(2)}</span>
              <span className="line-clamp-2 block text-muted-foreground">{s.excerpt}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TaskResult({ result, title }: { result: TaskResponse; title: string }) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const cited = result.citations.filter((c) => c.cited);
  const rest = result.citations.filter((c) => !c.cited);
  const md = `# ${title}\n\n${result.content}${sourcesMarkdown(result.citations)}`;
  return (
    <Card data-testid="task-result">
      <CardContent className="space-y-4">
        {result.insufficient_evidence && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">Not enough relevant text was found in the selected documents to answer this.</p>
        )}
        <div data-testid="task-content">
          <Markdown content={result.content} citations={result.citations} />
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(result.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} Copy
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)} data-testid="task-save-note">
            <BookmarkPlus aria-hidden /> Save as note
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              saveBlob(md, slug(title));
              toast.success("Markdown downloaded");
            }}
          >
            <Download aria-hidden /> Download .md
          </Button>
          <span className="ml-auto self-center text-xs text-muted-foreground">
            {result.provider} · {result.model}
          </span>
        </div>
        {cited.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cited sources</h4>
            <SourcesList sources={cited} />
          </div>
        )}
        {rest.length > 0 && (
          <div>
            <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
              <ChevronDown className={`size-4 transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden />
              All retrieved sources ({rest.length} not cited)
            </button>
            {showAll && <SourcesList sources={rest} title="Retrieved but not cited" />}
          </div>
        )}
      </CardContent>
      <SaveNoteDialog open={saveOpen} onOpenChange={setSaveOpen} defaultTitle={title} content={result.content + sourcesMarkdown(result.citations)} />
    </Card>
  );
}
