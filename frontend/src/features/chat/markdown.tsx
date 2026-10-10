"use client";

import { Check, Copy } from "lucide-react";
import { Children, isValidElement, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEvidence } from "@/features/chat/evidence";
import { isSafeHref, remarkCitations, remarkEvidenceKinds } from "@/lib/citations";
import type { SourceOut } from "@/types/api";

function nodeText(node: React.ReactNode): string {
  let out = "";
  Children.forEach(node, (c) => {
    if (typeof c === "string" || typeof c === "number") out += c;
    else if (isValidElement<{ children?: React.ReactNode }>(c)) out += nodeText(c.props.children);
  });
  return out;
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label="Copy code"
        className="absolute top-2 right-2 z-10 rounded-md border bg-background/80 p-1.5 text-muted-foreground opacity-0 transition hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        onClick={async () => {
          await navigator.clipboard?.writeText(nodeText(children));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

export function CitationChip({ source, group }: { source: SourceOut; group?: SourceOut[] }) {
  const { open } = useEvidence();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-testid="citation-chip"
            data-label={source.label}
            onClick={() => open(source, group)}
            aria-label={`Open source ${source.label}: ${source.document_title}${source.page_number ? `, page ${source.page_number}` : ""}`}
            className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-md bg-primary/10 px-1.5 align-baseline text-[0.7rem] font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        }
      >
        {source.label}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm flex-col items-start gap-1 py-2 text-left">
        <span className="font-medium">
          {source.document_title}
          {source.page_number ? ` · p.${source.page_number}` : ""}
        </span>
        <span className="line-clamp-4 opacity-90">“{source.excerpt}”</span>
        <span className="opacity-70">relevance {source.score.toFixed(2)}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Safe Markdown: no raw HTML, http/https/mailto links only, [S#] tokens become citation chips. */
export function Markdown({ content, citations = [] }: { content: string; citations?: SourceOut[] }) {
  const byLabel = useMemo(() => new Map(citations.map((c) => [c.label, c])), [citations]);
  // prev/next in the viewer steps through the cited sources (or all retrieved ones while streaming)
  const group = useMemo(() => (citations.some((c) => c.cited) ? citations.filter((c) => c.cited) : citations), [citations]);
  const plugins = useMemo(() => [remarkGfm, remarkEvidenceKinds, remarkCitations(new Set(byLabel.keys()))], [byLabel]);
  const components = useMemo(
    () =>
      ({
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
          isSafeHref(href) ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          ),
        pre: ({ children }: { children?: React.ReactNode }) => <CodeBlock>{children}</CodeBlock>,
        "cite-chip": ({ labels }: { labels?: string }) => (
          <>
            {(labels ?? "")
              .split(",")
              .map((l) => byLabel.get(l))
              .filter((s): s is SourceOut => !!s)
              .map((s) => (
                <CitationChip key={s.label} source={s} group={group} />
              ))}
          </>
        ),
      }) as unknown as Components,
    [byLabel, group],
  );
  return (
    <div className="prose-ara break-words">
      <ReactMarkdown remarkPlugins={plugins} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
