import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/features/dashboard/dashboard-view";
import type { Dashboard } from "@/types/api";

import { mockFetch, renderWithClient } from "./utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));
// recharts needs layout; the chart is not under test here
vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Stub, BarChart: Stub, Bar: Stub, CartesianGrid: Stub, Tooltip: Stub, XAxis: Stub, YAxis: Stub };
});

const empty: Dashboard = {
  documents: { total: 0, ready: 0, processing: 0, failed: 0 },
  conversations: 0,
  questions_asked: 0,
  notes: 0,
  collections: 0,
  storage_bytes: 0,
  popular_documents: [],
  queries_last_14_days: [{ date: "2026-10-10", count: 0 }],
  queries_by_kind: {},
  avg_query_latency_ms: null,
  recent_activity: [],
  recent_documents: [],
  active_jobs: [],
  index_health: { current_signature: "sig-1", stale_documents: 0 },
};

const populated: Dashboard = {
  ...empty,
  documents: { total: 3, ready: 1, processing: 1, failed: 1 },
  storage_bytes: 5000,
  recent_documents: [
    { id: "d1", title: "Attention paper", status: "ready", progress: 100, stage: "done", file_ext: ".pdf", size_bytes: 2048, page_count: 12, created_at: "2026-10-10T10:00:00Z" },
    { id: "d2", title: "Lab notes", status: "processing", progress: 60, stage: "embedding", file_ext: ".md", size_bytes: 900, page_count: null, created_at: "2026-10-10T10:05:00Z" },
    { id: "d3", title: "Scan", status: "failed", progress: 0, stage: "failed", file_ext: ".pdf", size_bytes: 100, page_count: null, created_at: "2026-10-10T10:06:00Z" },
  ],
  active_jobs: [{ id: "j1", document_id: "d2", document_title: "Lab notes", status: "running", stage: "embedding", progress: 60, attempts: 2, max_attempts: 3 }],
  index_health: { current_signature: "minilm-v1", stale_documents: 2 },
};

afterEach(() => vi.unstubAllGlobals());

function setup(data: Dashboard) {
  mockFetch({
    "/dashboard": data,
    "/jobs": { items: [{ id: "j9", document_id: "d3", kind: "ingest", status: "failed", attempts: 1, max_attempts: 3, progress: 0, stage: "failed", error_message: "No extractable text found (scanned PDF).", created_at: "2026-10-10T10:06:00Z", started_at: null, finished_at: null, document_title: "Scan" }], total: 1, page: 1, page_size: 3 },
  });
  return renderWithClient(<DashboardView />);
}

describe("DashboardView", () => {
  it("empty workspace: real zeros, empty states, no fabricated activity", async () => {
    setup(empty);
    expect(await screen.findByTestId("stat-documents")).toHaveTextContent("0");
    expect(screen.getByTestId("recent-documents")).toHaveTextContent("No documents yet");
    expect(screen.getByTestId("processing-idle")).toBeInTheDocument();
    expect(screen.queryByTestId("index-health-banner")).toBeNull();
    expect(screen.queryAllByTestId("recent-document")).toHaveLength(0);
    expect(screen.getByTestId("avg-latency")).toHaveTextContent("no data yet");
  });

  it("populated: recent documents with status, live job progress, failures with the error text, stale-index banner", async () => {
    setup(populated);
    const rows = await screen.findAllByTestId("recent-document");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Attention paper");
    expect(rows[0]).toHaveTextContent("12 pages");
    expect(rows[1]).toHaveAttribute("data-status", "processing");
    expect(rows[1]).toHaveTextContent("Creating embeddings");
    const job = screen.getByTestId("active-job");
    expect(job).toHaveTextContent("Lab notes");
    expect(job).toHaveTextContent("60%");
    expect(job).toHaveTextContent("attempt 2/3");
    expect(await screen.findByTestId("failed-job")).toHaveTextContent("No extractable text found (scanned PDF).");
    const banner = screen.getByTestId("index-health-banner");
    expect(banner).toHaveTextContent("2 documents are being re-indexed");
    expect(banner).toHaveTextContent("minilm-v1");
    expect(screen.getByTestId("stat-ready")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-failed")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-storage")).toHaveTextContent("4.9 KB");
  });

  it("works against an older API that lacks the new fields", async () => {
    const legacy: Partial<Dashboard> = { ...empty };
    delete legacy.recent_documents;
    delete legacy.active_jobs;
    delete legacy.index_health;
    setup(legacy as Dashboard);
    expect(await screen.findByTestId("stat-documents")).toBeInTheDocument();
    expect(screen.getByTestId("processing-idle")).toBeInTheDocument();
  });
});
