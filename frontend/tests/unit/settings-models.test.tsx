import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsView } from "@/features/settings/settings-view";
import type { SettingsOut } from "@/types/api";

import { mockFetch, renderWithClient } from "./utils";

let search = "tab=provider";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/settings", useSearchParams: () => new URLSearchParams(search) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn(), resolvedTheme: "light" }) }));

const SETTINGS: SettingsOut = {
  theme: "light",
  llm_provider: "groq",
  llm_model: "",
  top_k: 8,
  score_threshold: 0.25,
  context_token_budget: 6000,
  hybrid_search: true,
  embedding_provider: "hash",
  embedding_model: "hash-bow-v1",
  embedding_dim: 384,
  chunk_size_tokens: 800,
  chunk_overlap_tokens: 120,
  providers: [
    { id: "groq", label: "Groq (hosted)", configured: true },
    { id: "ollama", label: "Ollama (local)", configured: true },
  ],
  overrides: {},
  retrieval_mode: "lexical",
  embedding_signature: "hash:hash-bow-v1:384:800/120",
  llm_status: { status: "missing_model", hint: "Set LLM_MODEL on the API (or choose a model below)." },
};

let models: unknown = { provider: "groq", models: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"], error: null };
beforeEach(() => {
  search = "tab=provider";
  models = { provider: "groq", models: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"], error: null };
  mockFetch({ "/settings/models": () => models, "/settings": () => SETTINGS });
});
afterEach(() => vi.unstubAllGlobals());

describe("Settings → AI provider", () => {
  it("shows a clear callout when the server has no model configured", async () => {
    renderWithClient(<SettingsView />);
    const callout = await screen.findByTestId("llm-status-callout");
    expect(callout).toHaveTextContent("No LLM model configured");
    expect(callout).toHaveTextContent("Set LLM_MODEL on the API");
  });

  it("offers the provider's models as a combobox, with free-text fallback", async () => {
    const user = userEvent.setup();
    renderWithClient(<SettingsView />);
    await waitFor(() => expect(screen.getByTestId("model-options").querySelectorAll("option")).toHaveLength(2));
    const values = Array.from(screen.getByTestId("model-options").querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).toEqual(["llama-3.3-70b-versatile", "openai/gpt-oss-20b"]);
    expect(screen.getByTestId("models-hint")).toHaveTextContent("2 models reported by groq");
    const input = screen.getByTestId("model-input");
    expect(input).toHaveAttribute("list", "model-options");
    await user.type(input, "llama-3.3-70b-versatile");
    expect(screen.queryByTestId("model-unknown")).toBeNull();
    await user.clear(input);
    await user.type(input, "my-custom-model");
    expect(await screen.findByTestId("model-unknown")).toHaveTextContent(/isn't in the provider's current list/);
  });

  it("surfaces the provider's error when the model list can't be loaded, and keeps manual entry", async () => {
    models = { provider: "groq", models: [], error: "Groq rejected the API key (check GROQ_API_KEY)." };
    renderWithClient(<SettingsView />);
    await waitFor(() => expect(screen.getByTestId("models-hint")).toHaveTextContent("Groq rejected the API key"));
    expect(screen.getByTestId("models-hint")).toHaveTextContent("You can still type a model id");
    expect(screen.getByTestId("model-input")).not.toBeDisabled();
  });

  it("refresh re-fetches the model list", async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({ "/settings/models": () => models, "/settings": () => SETTINGS });
    renderWithClient(<SettingsView />);
    await waitFor(() => expect(calls.filter((c) => c.url.pathname.endsWith("/settings/models"))).toHaveLength(1));
    await user.click(screen.getByTestId("refresh-models"));
    await waitFor(() => expect(calls.filter((c) => c.url.pathname.endsWith("/settings/models"))).toHaveLength(2));
  });
});

describe("Settings → retrieval mode honesty", () => {
  it("labels lexical matching as not semantic", async () => {
    search = "tab=retrieval";
    renderWithClient(<SettingsView />);
    const note = await screen.findByTestId("retrieval-mode-note");
    expect(note).toHaveTextContent("Lexical (keyword-like) matching — not semantic");
  });

  it("labels semantic vector search when active", async () => {
    search = "tab=embeddings";
    mockFetch({ "/settings": () => ({ ...SETTINGS, retrieval_mode: "semantic", embedding_provider: "sentence-transformers" }) });
    renderWithClient(<SettingsView />);
    expect(await screen.findByTestId("retrieval-mode-note")).toHaveTextContent("Semantic vector search is active");
    expect(screen.getByTestId("embedding-info")).toHaveTextContent("Semantic vector search");
  });
});

describe("Settings → system health", () => {
  it("explains a missing model, stale index and broken storage without secrets", async () => {
    search = "tab=health";
    mockFetch({
      "/ready": {
        status: "degraded",
        version: "1.0.0",
        checks: {
          database: { ok: true, backend: "postgresql" },
          llm: { provider: "groq", status: "missing_model", hint: "LLM_MODEL is empty." },
          embeddings: { ok: true, provider: "hash", retrieval_mode: "lexical", dim: 384, signature: "sig", stale_documents: 3 },
          storage: { ok: false, backend: "s3", error: "RuntimeError" },
        },
      },
      "/settings": () => SETTINGS,
    });
    renderWithClient(<SettingsView />);
    expect(await screen.findByTestId("health-llm-callout")).toHaveTextContent("set LLM_MODEL on the API");
    expect(screen.getByTestId("health-stale-callout")).toHaveTextContent("3 documents are being re-indexed");
    expect(screen.getByTestId("health-storage-callout")).toHaveTextContent("RuntimeError");
    expect(screen.getByTestId("health-embeddings")).toHaveTextContent("Lexical (keyword-like) matching");
    expect(screen.getByTestId("health-llm")).toHaveAttribute("data-ok", "false");
    expect(screen.getByTestId("health-database")).toHaveAttribute("data-ok", "true");
  });

  it("falls back to the legacy llm check shape", async () => {
    search = "tab=health";
    mockFetch({ "/ready": { status: "ready", version: "1", checks: { llm: { provider: "groq", configured: false } } }, "/settings": () => SETTINGS });
    renderWithClient(<SettingsView />);
    expect(await screen.findByTestId("health-llm-callout")).toBeInTheDocument();
  });
});
