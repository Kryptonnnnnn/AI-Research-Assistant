import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { EvidenceBody, viewerHref } from "@/features/chat/evidence";
import { splitAroundExcerpt } from "@/lib/highlight";
import type { SourceOut } from "@/types/api";

const renderBody = (source: SourceOut) =>
  render(
    <Sheet open>
      <SheetContent>
        <EvidenceBody source={source} />
      </SheetContent>
    </Sheet>,
  );

const base: SourceOut = {
  id: null,
  label: "S2",
  chunk_id: "c-1",
  document_id: "d-1",
  document_title: "My Paper",
  page_number: 4,
  section: "Results",
  chunk_index: 7,
  excerpt: "The light-dependent reactions produce ATP.",
  chunk_text: "Before text. The light-dependent reactions produce ATP. After text.",
  score: 0.9123,
  vector_score: 0.8,
  keyword_score: 0.31,
  cited: true,
};

describe("EvidenceBody", () => {
  it("shows title, page, section, the highlighted exact excerpt and debug metadata", () => {
    renderBody(base);
    expect(screen.getByText("My Paper")).toBeInTheDocument();
    expect(screen.getByText(/Page 4 · Results/)).toBeInTheDocument();
    const mark = screen.getByTestId("highlighted-excerpt");
    expect(mark).toHaveTextContent("The light-dependent reactions produce ATP.");
    expect(mark.tagName).toBe("MARK");
    expect(screen.getByTestId("evidence-chunk")).toHaveTextContent("Before text. The light-dependent reactions produce ATP. After text.");
    expect(screen.getByText("0.912")).toBeInTheDocument();
    expect(screen.getByText("c-1")).toBeInTheDocument();
  });

  it("links to the viewer at the cited page and chunk", () => {
    renderBody(base);
    const href = screen.getByTestId("open-in-viewer").getAttribute("href")!;
    expect(href).toMatch(/^\/documents\/d-1\?/);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("page")).toBe("4");
    expect(q.get("chunk")).toBe("c-1");
    expect(q.get("excerpt")).toBe(base.excerpt);
  });

  it("disables the viewer link with an explanation when the document was deleted", () => {
    renderBody({ ...base, document_id: null, chunk_id: null });
    expect(screen.queryByTestId("open-in-viewer")).toBeNull();
    expect(screen.getByTestId("viewer-unavailable")).toHaveTextContent(/deleted/);
    expect(viewerHref({ document_id: null, page_number: 1, chunk_id: null })).toBeNull();
  });
});

describe("splitAroundExcerpt", () => {
  it("finds exact and whitespace-insensitive matches, and returns null when absent", () => {
    expect(splitAroundExcerpt("a b c", "b")).toEqual({ before: "a ", match: "b", after: " c" });
    expect(splitAroundExcerpt("The  quick\nbrown fox jumps", "The quick brown fox")?.match).toBe("The  quick\nbrown fox");
    expect(splitAroundExcerpt("nothing here", "completely different text")).toBeNull();
    expect(splitAroundExcerpt("abc", "")).toBeNull();
  });
});
