import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { EvidenceProvider } from "@/features/chat/evidence";
import { Markdown } from "@/features/chat/markdown";
import { isSafeHref } from "@/lib/citations";
import type { SourceOut } from "@/types/api";

const src = (label: string, extra: Partial<SourceOut> = {}): SourceOut => ({
  id: null,
  label,
  chunk_id: `chunk-${label}`,
  document_id: `doc-${label}`,
  document_title: `Paper ${label}`,
  page_number: 3,
  section: null,
  chunk_index: 0,
  excerpt: `Excerpt for ${label} about chlorophyll.`,
  chunk_text: `Intro. Excerpt for ${label} about chlorophyll. Outro.`,
  score: 0.8,
  vector_score: 0.7,
  keyword_score: 0.2,
  cited: true,
  ...extra,
});

function renderMd(content: string, citations: SourceOut[]) {
  return render(
    <TooltipProvider>
      <EvidenceProvider>
        <Markdown content={content} citations={citations} />
      </EvidenceProvider>
    </TooltipProvider>,
  );
}

describe("citation chips", () => {
  it("turns a known [S1] token into a clickable chip", async () => {
    renderMd("Chlorophyll absorbs light [S1].", [src("S1")]);
    const chip = screen.getByTestId("citation-chip");
    expect(chip).toHaveTextContent("S1");
    expect(chip).toHaveAccessibleName(/Paper S1, page 3/);
    await userEvent.click(chip);
    const panel = await screen.findByTestId("evidence-panel");
    expect(within(panel).getByTestId("evidence-excerpt")).toHaveTextContent("Excerpt for S1 about chlorophyll.");
  });

  it("renders one chip per label for [S1, S2] and leaves unknown labels as text", () => {
    renderMd("Two sources [S1, S2] and a made-up one [S9].", [src("S1"), src("S2")]);
    expect(screen.getAllByTestId("citation-chip").map((c) => c.textContent)).toEqual(["S1", "S2"]);
    expect(screen.getByText(/made-up one \[S9\]/)).toBeInTheDocument();
  });

  it("does not turn tokens inside code into chips", () => {
    renderMd("Use `[S1]` literally.\n\n```\n[S1]\n```", [src("S1")]);
    expect(screen.queryByTestId("citation-chip")).toBeNull();
  });

  it("renders without chips when there are no citations", () => {
    renderMd("Plain answer [S1].", []);
    expect(screen.queryByTestId("citation-chip")).toBeNull();
    expect(screen.getByText(/Plain answer \[S1\]\./)).toBeInTheDocument();
  });
});

describe("safe markdown", () => {
  it("renders raw HTML inertly (no script / handlers become elements)", () => {
    const { container } = renderMd('Hello <script>window.__pwned=1</script> <img src=x onerror="window.__pwned=2"> **bold**', []);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(container.querySelector("strong")).toHaveTextContent("bold");
  });

  it("only allows http(s)/mailto links and adds rel=noopener noreferrer", () => {
    const { container } = renderMd("[ok](https://example.com) [mail](mailto:a@b.co) [bad](javascript:alert(1))", []);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    links.forEach((a) => {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    });
    expect(container.innerHTML).not.toContain("javascript:");
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("https://x.y")).toBe(true);
  });

  it("renders tables, lists and highlighted code blocks with a copy button", () => {
    const { container } = renderMd("| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n```js\nconst x = 1;\n```", []);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre code.hljs, pre code")).toHaveTextContent("const x = 1;");
    expect(screen.getByLabelText("Copy code")).toBeInTheDocument();
  });

  it("marks Interpretation / Insufficient evidence paragraphs", () => {
    const { container } = renderMd("**Interpretation:** my reading.\n\n**Insufficient evidence:** nothing on X.\n\nNormal.", []);
    expect(container.querySelector('[data-kind="interpretation"]')).toHaveTextContent("my reading");
    expect(container.querySelector('[data-kind="insufficient"]')).toHaveTextContent("nothing on X");
  });
});
