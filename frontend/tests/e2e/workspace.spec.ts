import { expect, test } from "@playwright/test";

import { ask, fixture, register, uploadAndWaitReady } from "./helpers";

// Phase 5 redesign flows: docked viewer pane, command palette, global upload, library views, dashboard, honesty labels, error cards.

test("citation opens a docked viewer beside the answer with the highlighted passage, and it can be collapsed and reopened", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "plants.pdf");
  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  const answer = page.getByTestId("assistant-message").last();
  await expect(answer).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await answer.getByTestId("citation-chip").first().click();

  const panel = page.getByTestId("evidence-panel");
  await expect(panel).toBeVisible();
  // docked (an <aside>, not a modal dialog) and the conversation stays visible next to it
  expect(await panel.evaluate((el) => el.tagName)).toBe("ASIDE");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const [thread, pane] = await Promise.all([page.getByTestId("thread").boundingBox(), panel.boundingBox()]);
  expect(thread!.x + thread!.width).toBeLessThanOrEqual(pane!.x + 2);
  await expect(panel.getByTestId("highlighted-excerpt")).toBeVisible();
  await expect(panel).toContainText("Page 2");

  // Document tab: the PDF opens at the cited page
  await panel.getByTestId("viewer-tab-document").click();
  await expect(panel.getByTestId("pane-pdf-frame")).toHaveAttribute("src", /\/file#page=2$/);
  await expect(panel.getByTestId("pane-excerpt")).toContainText(/chlorophyll|photosynthesis|light/i);

  // collapse / reopen
  await panel.getByTestId("viewer-close").click();
  await expect(page.getByTestId("evidence-panel")).toHaveCount(0);
  await page.getByTestId("reopen-viewer").click();
  await expect(page.getByTestId("evidence-panel")).toBeVisible();
});

test("on narrower screens the viewer becomes a sheet", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  await expect(page.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByTestId("citation-chip").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("evidence-excerpt")).toBeVisible();
  // plain-text documents show the extracted passage (not a PDF frame) in the Document tab
  await sheet.getByTestId("viewer-tab-document").click();
  await expect(sheet.getByTestId("pane-chunk").first()).toBeVisible();
  await expect(sheet.getByTestId("pane-pdf-frame")).toHaveCount(0);
});

test("⌘K command palette searches documents and jumps to them", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/dashboard");
  await page.keyboard.press("ControlOrMeta+K");
  const input = page.getByTestId("palette-input");
  await expect(input).toBeVisible();
  await input.fill("photosyn");
  const hit = page.getByTestId("palette-document").first();
  await expect(hit).toContainText("photosynthesis");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  await expect(page.getByTestId("doc-detail-title")).toHaveText("photosynthesis");

  // pages and actions work from the palette too
  await page.getByTestId("open-palette").click();
  await page.getByTestId("palette-input").fill("settings");
  await page.getByTestId("palette-page").first().click();
  await expect(page).toHaveURL(/\/settings/);
});

test("toolbar upload works from any page; library supports grid view, search and bulk delete", async ({ page }) => {
  await register(page);
  await page.goto("/dashboard");
  await page.getByTestId("global-file-input").setInputFiles(fixture("photosynthesis.txt"));
  await expect(page).toHaveURL(/\/documents/);
  await expect(page.getByTestId("doc-status").first()).toContainText("Ready", { timeout: 30_000 });
  await page.getByTestId("global-file-input").setInputFiles(fixture("transformers.txt"));
  await expect(page.getByTestId("doc-row")).toHaveCount(2);
  await expect(page.getByTestId("doc-status").filter({ hasText: "Ready" })).toHaveCount(2, { timeout: 30_000 });

  // file-type tiles, grid toggle persists across reloads
  await expect(page.getByTestId("file-tile").first()).toHaveAttribute("data-ext", "TXT");
  await page.getByTestId("view-grid").click();
  await expect(page.getByTestId("doc-list")).toHaveAttribute("data-view", "grid");
  await page.reload();
  await expect(page.getByTestId("doc-list")).toHaveAttribute("data-view", "grid");

  // search narrows the library
  await page.getByTestId("doc-search").fill("transformers");
  await expect(page.getByTestId("doc-row")).toHaveCount(1);
  await expect(page.getByTestId("doc-title")).toHaveText("transformers");
  await page.getByTestId("doc-search").fill("");
  await expect(page.getByTestId("doc-row")).toHaveCount(2);

  // bulk select → delete with confirmation
  await page.getByTestId("select-page").click();
  await expect(page.getByTestId("bulk-count")).toHaveText("2 selected");
  await page.getByTestId("bulk-delete").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByText("No documents yet")).toBeVisible();
  await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
});

test("dashboard lists the recent document and shows processing activity from real data", async ({ page }) => {
  await register(page);
  await page.goto("/dashboard");
  await expect(page.getByTestId("recent-documents")).toContainText("No documents yet");
  await expect(page.getByTestId("processing-idle")).toBeVisible();
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/dashboard");
  const row = page.getByTestId("recent-document").first();
  await expect(row).toContainText("photosynthesis");
  await expect(row).toHaveAttribute("data-status", "ready");
  await expect(row.getByTestId("file-tile")).toHaveAttribute("data-ext", "TXT");
  await expect(page.getByTestId("processing-idle")).toBeVisible();
  await expect(page.getByTestId("index-health-banner")).toHaveCount(0);
});

test("research Conflicts tab needs two documents, then returns a cited analysis", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/documents");
  await page.getByTestId("file-input").setInputFiles(fixture("transformers.txt"));
  await expect(page.getByTestId("doc-status").filter({ hasText: "Ready" })).toHaveCount(2, { timeout: 30_000 });

  await page.goto("/research");
  await page.getByTestId("tab-conflicts").click();
  await expect(page.getByText(/where documents disagree/i)).toBeVisible();
  const run = page.getByTestId("run-conflicts");
  await expect(run).toBeDisabled();
  await page.getByTestId("research-docs-conflicts").click();
  await page.getByRole("checkbox", { name: "photosynthesis" }).click();
  await page.getByRole("checkbox", { name: "transformers" }).click();
  await page.keyboard.press("Escape");
  await expect(run).toBeEnabled();
  await run.click();
  const result = page.getByTestId("task-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.getByTestId("citation-chip").first()).toBeVisible();
});

test("an unconfigured model shows a helpful card that links to Settings → AI provider", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  // choose Ollama with no model: a real "not configured" failure from the backend, no mocking
  await page.goto("/settings?tab=provider");
  await page.getByTestId("provider-select").selectOption("ollama");
  await page.getByTestId("model-input").fill("");
  await page.getByTestId("provider-save").click();
  await expect(page.getByText("Provider settings saved")).toBeVisible();

  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  const card = page.getByTestId("message-error-card").or(page.getByTestId("stream-error")).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toHaveAttribute("data-kind", "not_configured");
  await expect(card.getByTestId("error-title")).toContainText("isn't configured");
  await card.getByTestId("open-provider-settings").click();
  await expect(page).toHaveURL(/\/settings\?tab=provider/);
  await expect(page.getByTestId("provider-select")).toBeVisible();
});

test("a rate-limited provider response explains what to do", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.route("**/api/v1/chat/stream", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "provider_rate_limited", message: "Groq rate limit reached. Wait a moment and retry." } }) }),
  );
  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  const card = page.getByTestId("stream-error");
  await expect(card).toHaveAttribute("data-kind", "rate_limited");
  await expect(card).toContainText("rate-limiting");
  await expect(card.getByTestId("retry-stream")).toBeVisible();
  await expect(card.getByTestId("open-provider-settings")).toHaveCount(0);
});

test("retrieval mode is labelled honestly (offline hash embedder → lexical, not semantic)", async ({ page }) => {
  await register(page);
  await page.goto("/search");
  await expect(page.getByTestId("search-mode")).toContainText("Lexical");
  await expect(page.getByTestId("search-lexical-note")).toContainText("not active");
  await page.goto("/settings?tab=embeddings");
  await expect(page.getByTestId("retrieval-mode-note")).toContainText("not semantic");
  await page.goto("/settings?tab=health");
  await expect(page.getByTestId("health-embeddings")).toContainText("Lexical");
});

test("sidebar collapses to icons and remembers the choice", async ({ page }) => {
  await register(page);
  const aside = page.getByRole("complementary", { name: "Sidebar" });
  await expect(aside).toHaveAttribute("data-collapsed", "false");
  await page.getByTestId("sidebar-toggle").click();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  await expect(aside.getByRole("link", { name: "Documents" })).toBeVisible(); // icon-only links keep an accessible name
  await page.reload();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  await page.getByTestId("sidebar-toggle").click();
  await expect(aside).toHaveAttribute("data-collapsed", "false");
});

test("New conversation starts a fresh chat after the first answer (regression: stale route params)", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  await expect(page.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(page.getByTestId("followup-chip").first()).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("new-chat").click();
  await expect(page.getByTestId("user-message")).toHaveCount(0);
  await expect(page.getByTestId("conversation-heading")).toHaveText("New conversation");
  await expect(page).toHaveURL(/\/chat$/);

  await ask(page, "What do the light-dependent reactions produce?");
  await expect(page.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(page.getByTestId("user-message")).toHaveCount(1); // not appended to the first conversation
  await expect(page.getByTestId("conversation-item")).toHaveCount(2);

  // switching back to the first conversation through the history column loads it
  await page.getByTestId("conversation-item").nth(1).getByRole("link").click();
  await expect(page.getByTestId("user-message")).toContainText("chloroplasts");
});
