import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentsView } from "@/features/documents/documents-view";

import { json, mockFetch, renderWithClient } from "./utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/documents", useSearchParams: () => new URLSearchParams() }));

const doc = (over: Record<string, unknown>) => ({
  original_filename: "f.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  page_count: null,
  chunk_count: 3,
  progress: 100,
  stage: "done",
  error_message: null,
  access_count: 0,
  last_accessed_at: null,
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:00Z",
  collection_ids: [],
  ...over,
});
const DOCS = [
  doc({ id: "d1", title: "Attention paper", file_ext: ".pdf", status: "ready", page_count: 12 }),
  doc({ id: "d2", title: "Lab notes", file_ext: ".md", status: "processing", progress: 55, stage: "embedding" }),
  doc({ id: "d3", title: "Broken scan", file_ext: ".pdf", status: "failed", progress: 0, stage: "failed", error_message: "No extractable text found. This looks like a scanned PDF." }),
];

let deleted: string[] = [];
let assigned: { path: string; body: unknown } | null = null;
beforeEach(() => {
  localStorage.clear();
  deleted = [];
  assigned = null;
  mockFetch({
    "/documents/d": (url, init) => {
      if (init?.method === "DELETE") deleted.push(url.pathname.split("/").pop()!);
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({});
    },
    "/documents": { items: DOCS, total: 3, page: 1, page_size: 20 },
    "/collections/col1/documents": (url, init) => {
      assigned = { path: url.pathname, body: JSON.parse(String(init?.body)) };
      return json({ id: "col1", name: "Bio", description: "", document_count: 2, created_at: "2026-10-10T10:00:00Z" });
    },
    "/collections": [{ id: "col1", name: "Bio", description: "", document_count: 0, created_at: "2026-10-10T10:00:00Z" }],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("document library", () => {
  it("shows file-type tiles, status states, stage labels and failure reasons", async () => {
    renderWithClient(<DocumentsView />);
    const rows = await screen.findAllByTestId("doc-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByTestId("file-tile")).toHaveAttribute("data-ext", "PDF");
    expect(within(rows[1]).getByTestId("file-tile")).toHaveAttribute("data-ext", "MD");
    expect(within(rows[0]).getByTestId("doc-status")).toHaveTextContent("Ready");
    expect(within(rows[1]).getByTestId("doc-status")).toHaveTextContent("Creating embeddings · 55%");
    expect(within(rows[2]).getByTestId("doc-error")).toHaveTextContent("scanned PDF");
    expect(within(rows[2]).getByTestId("retry-doc")).toBeInTheDocument();
  });

  it("toggles between list and grid layouts and remembers the choice", async () => {
    const user = userEvent.setup();
    renderWithClient(<DocumentsView />);
    const list = await screen.findByTestId("doc-list");
    expect(list).toHaveAttribute("data-view", "list");
    await user.click(screen.getByTestId("view-grid"));
    expect(screen.getByTestId("doc-list")).toHaveAttribute("data-view", "grid");
    expect(screen.getAllByTestId("doc-row")[0]).toHaveAttribute("data-view", "grid");
    expect(screen.getByTestId("view-grid")).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("ara.docs.view")).toBe("grid");
    await user.click(screen.getByTestId("view-list"));
    expect(screen.getByTestId("doc-list")).toHaveAttribute("data-view", "list");
  });

  it("restores the saved layout on load", async () => {
    localStorage.setItem("ara.docs.view", "grid");
    renderWithClient(<DocumentsView />);
    await waitFor(() => expect(screen.getByTestId("doc-list")).toHaveAttribute("data-view", "grid"));
  });

  it("bulk-selects documents and deletes them after confirmation", async () => {
    const user = userEvent.setup();
    renderWithClient(<DocumentsView />);
    await screen.findAllByTestId("doc-row");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    await user.click(screen.getAllByTestId("doc-select")[0]);
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("1 selected");
    await user.click(screen.getByTestId("select-page"));
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("3 selected");
    await user.click(screen.getByTestId("bulk-delete"));
    await user.click(await screen.findByTestId("confirm-action"));
    await waitFor(() => expect(deleted.sort()).toEqual(["d1", "d2", "d3"]));
    await waitFor(() => expect(screen.queryByTestId("bulk-bar")).toBeNull());
  });

  it("bulk-adds the selection to a collection", async () => {
    const user = userEvent.setup();
    renderWithClient(<DocumentsView />);
    await screen.findAllByTestId("doc-row");
    await user.click(screen.getAllByTestId("doc-select")[0]);
    await user.click(screen.getAllByTestId("doc-select")[1]);
    await user.click(screen.getByTestId("bulk-assign"));
    await user.click(await screen.findByTestId("bulk-assign-save"));
    await waitFor(() => expect(assigned).not.toBeNull());
    expect(assigned!.path).toBe("/api/v1/collections/col1/documents");
    expect(assigned!.body).toEqual({ document_ids: ["d1", "d2"] });
  });

  it("clearing the selection hides the bulk bar", async () => {
    const user = userEvent.setup();
    renderWithClient(<DocumentsView />);
    await screen.findAllByTestId("doc-row");
    await user.click(screen.getAllByTestId("doc-select")[0]);
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });
});
