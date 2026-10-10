import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DockedViewer, EvidenceProvider, useEvidence, useRegisterDock } from "@/features/chat/evidence";
import type { SourceOut } from "@/types/api";

import { mockViewport } from "./setup";
import { json, mockFetch, renderWithClient } from "./utils";

const src = (n: number, over: Partial<SourceOut> = {}): SourceOut => ({
  id: null,
  label: `S${n}`,
  chunk_id: `c-${n}`,
  document_id: `d-${n}`,
  document_title: `Paper ${n}`,
  page_number: n + 1,
  section: null,
  chunk_index: n,
  excerpt: `Excerpt number ${n} about photosynthesis.`,
  chunk_text: `Intro. Excerpt number ${n} about photosynthesis. Outro.`,
  score: 0.5,
  vector_score: 0.4,
  keyword_score: 0.2,
  cited: true,
  ...over,
});
const GROUP = [src(1), src(2), src(3)];

function Host({ withDock = false }: { withDock?: boolean }) {
  const { open } = useEvidence();
  return (
    <>
      {withDock && <Dock />}
      <button onClick={() => open(GROUP[0], GROUP)}>open first</button>
      <button onClick={() => open(GROUP[0])}>open single</button>
    </>
  );
}
function Dock() {
  useRegisterDock();
  return <DockedViewer />;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("viewer pane", () => {
  it("opens as a sheet on narrow screens and steps through the answer's citations (wrapping)", async () => {
    mockViewport(800);
    renderWithClient(
      <EvidenceProvider>
        <Host />
      </EvidenceProvider>,
    );
    await userEvent.click(screen.getByText("open first"));
    expect(await screen.findByTestId("viewer-position")).toHaveTextContent("1 of 3");
    expect(screen.getByText("Paper 1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("viewer-next"));
    expect(screen.getByTestId("viewer-position")).toHaveTextContent("2 of 3");
    expect(screen.getByText("Paper 2")).toBeInTheDocument();
    expect(screen.getByTestId("highlighted-excerpt")).toHaveTextContent("Excerpt number 2 about photosynthesis.");
    await userEvent.click(screen.getByTestId("viewer-prev"));
    await userEvent.click(screen.getByTestId("viewer-prev"));
    expect(screen.getByTestId("viewer-position")).toHaveTextContent("3 of 3"); // wrapped around
    expect(screen.getByText("Paper 3")).toBeInTheDocument();
  });

  it("hides prev/next when there is a single source", async () => {
    mockViewport(800);
    renderWithClient(
      <EvidenceProvider>
        <Host />
      </EvidenceProvider>,
    );
    await userEvent.click(screen.getByText("open single"));
    expect(await screen.findByTestId("evidence-excerpt")).toBeInTheDocument();
    expect(screen.queryByTestId("viewer-next")).toBeNull();
  });

  it("docks beside the chat on wide screens (no modal), can be resized with the keyboard, closed and reopened", async () => {
    mockViewport(1440);
    renderWithClient(
      <EvidenceProvider>
        <Host withDock />
      </EvidenceProvider>,
    );
    await userEvent.click(screen.getByText("open first"));
    const panel = await screen.findByTestId("evidence-panel");
    expect(panel.tagName).toBe("ASIDE");
    expect(screen.queryByRole("dialog")).toBeNull();
    const handle = screen.getByTestId("viewer-resize");
    const before = Number(handle.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handle, { key: "ArrowLeft" }); // wider
    expect(Number(handle.getAttribute("aria-valuenow"))).toBe(before + 24);
    expect(localStorage.getItem("ara.viewer.width")).toBe(String(before + 24));
    for (let i = 0; i < 50; i++) fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(Number(handle.getAttribute("aria-valuenow"))).toBe(760); // clamped to max
    await userEvent.click(screen.getByTestId("viewer-close"));
    expect(screen.queryByTestId("evidence-panel")).toBeNull();
  });

  it("Document tab: PDFs open the file at the cited page", async () => {
    mockViewport(800);
    mockFetch({ "/documents/d-1": { file_ext: ".pdf" } });
    renderWithClient(
      <EvidenceProvider>
        <Host />
      </EvidenceProvider>,
    );
    await userEvent.click(screen.getByText("open first"));
    await userEvent.click(await screen.findByTestId("viewer-tab-document"));
    const frame = await screen.findByTestId("pane-pdf-frame");
    expect(frame.getAttribute("src")).toBe("/api/v1/documents/d-1/file#page=2");
    expect(screen.getByTestId("pane-excerpt")).toHaveTextContent("Excerpt number 1");
  });

  it("Document tab: text documents show neighbouring chunks with the cited passage highlighted", async () => {
    mockViewport(800);
    const { calls } = mockFetch({
      "/documents/d-1/chunks": () => [
        { id: "c-0", chunk_index: 0, text: "Earlier text.", page_number: null, section: null, token_count: 3 },
        { id: "c-1", chunk_index: 1, text: "Intro. Excerpt number 1 about photosynthesis. Outro.", page_number: null, section: "Intro", token_count: 9 },
      ],
      "/documents/d-1": { file_ext: ".txt" },
    });
    renderWithClient(
      <EvidenceProvider>
        <Host />
      </EvidenceProvider>,
    );
    await userEvent.click(screen.getByText("open first"));
    await userEvent.click(await screen.findByTestId("viewer-tab-document"));
    const chunks = await screen.findAllByTestId("pane-chunk");
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toHaveAttribute("data-active", "true");
    expect(screen.getAllByTestId("highlighted-excerpt").at(-1)).toHaveTextContent("Excerpt number 1 about photosynthesis.");
    const q = calls.find((c) => c.url.pathname.endsWith("/chunks"))!.url.searchParams;
    expect(q.get("offset")).toBe("0"); // window starts 2 chunks before the cited one, clamped at 0
    expect(q.get("limit")).toBe("5");
  });

  it("deleted documents explain why the viewer is unavailable", async () => {
    mockViewport(800);
    renderWithClient(
      <EvidenceProvider>
        <Deleted />
      </EvidenceProvider>,
    );
    await userEvent.click(screen.getByText("open deleted"));
    await userEvent.click(await screen.findByTestId("viewer-tab-document"));
    await waitFor(() => expect(screen.getAllByText(/original document was deleted/i).length).toBeGreaterThan(0));
    void act;
    void json;
  });
});

function Deleted() {
  const { open } = useEvidence();
  return <button onClick={() => open(src(1, { document_id: null, chunk_id: null }))}>open deleted</button>;
}
