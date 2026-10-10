import { expect, test } from "@playwright/test";

import { ask, fixture, login, logout, PASSWORD, register, uniqueEmail, uploadAndWaitReady } from "./helpers";

test("register → logout → login", async ({ page }) => {
  const email = uniqueEmail("auth");
  await register(page, email);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await logout(page);
  // protected routes bounce to login when signed out
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login/);
  await login(page, email);
  await expect(page.getByTestId("user-menu")).toContainText(email);
});

test("wrong password shows a server error", async ({ page }) => {
  const email = uniqueEmail("bad");
  await register(page, email);
  await logout(page);
  await page.fill("#email", email);
  await page.fill("#password", "WrongPassw0rd!!");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-error")).toContainText("Invalid email or password");
});

test("upload PDF → ask → streamed answer with citation → evidence → viewer → persists after reload", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "plants.pdf");

  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  const answer = page.getByTestId("assistant-message").last();
  await expect(answer).toBeVisible();
  const chip = answer.getByTestId("citation-chip").first();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(answer).toHaveAttribute("data-status", "complete", { timeout: 30_000 });

  await chip.click();
  const panel = page.getByTestId("evidence-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("evidence-excerpt")).toContainText(/chlorophyll|photosynthesis|light/i);
  await expect(panel.getByTestId("highlighted-excerpt")).toBeVisible();
  await expect(panel).toContainText("Page 2");

  await panel.getByTestId("open-in-viewer").click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+\?.*page=2/);
  await expect(page.getByTestId("pdf-frame")).toHaveAttribute("src", /file#page=2$/);
  await expect(page.getByTestId("viewer-excerpt")).toBeVisible();
  // the PDF is really served (inline, through the same-origin proxy, with the session cookie)
  const pdf = await page.request.get((await page.getByTestId("pdf-frame").getAttribute("src"))!.replace(/#.*$/, ""));
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["content-disposition"]).toContain("inline");
  // the extracted-text tab highlights the cited chunk
  await page.getByTestId("tab-text").click();
  await expect(page.locator('[data-testid=chunk][data-active]')).toBeVisible();
  await expect(page.locator("mark.excerpt").first()).toBeVisible();

  // conversation survives a reload and appears in the list
  await page.goto("/chat");
  const item = page.getByTestId("conversation-item").first();
  await expect(item).toBeVisible();
  await item.getByRole("link").click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]+$/);
  await expect(page.getByTestId("assistant-message").first().getByTestId("citation-chip").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("user-message")).toContainText("chloroplasts");
  await expect(page.getByTestId("assistant-message").first().getByTestId("citation-chip").first()).toBeVisible();
  await expect(page.getByTestId("toggle-sources").first()).toBeVisible();
});

test("off-topic question shows the insufficient-evidence banner and no citations", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/chat");
  await ask(page, "Who won the 1966 football world cup final?");
  await expect(page.getByTestId("insufficient-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("citation-chip")).toHaveCount(0);
});

test("another user cannot open someone else's document", async ({ page, browser }) => {
  await register(page);
  const row = await uploadAndWaitReady(page, "photosynthesis.txt");
  const href = await row.getByTestId("doc-title").getAttribute("href");
  expect(href).toMatch(/^\/documents\//);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await register(other);
  await other.goto(href!);
  await expect(other.getByTestId("error-message")).toContainText("Document not found");
  await other.goto("/documents");
  await expect(other.getByTestId("doc-row")).toHaveCount(0);
  await ctx.close();
});

test("collection: create, add document, chat scoped to it", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/documents");
  await page.getByTestId("file-input").setInputFiles(fixture("transformers.txt"));
  await expect(page.getByTestId("doc-row")).toHaveCount(2);
  await expect(page.getByTestId("doc-status").filter({ hasText: "Ready" })).toHaveCount(2, { timeout: 30_000 });

  await page.goto("/collections");
  await page.getByTestId("new-collection").first().click();
  await page.getByTestId("collection-name").fill("Plant biology");
  await page.getByTestId("collection-save").click();
  await expect(page.getByTestId("collection-item")).toContainText("Plant biology");

  await page.getByTestId("collection-add-docs").click();
  await page.getByRole("checkbox", { name: "photosynthesis" }).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("collection-add-submit").click();
  await expect(page.getByTestId("collection-doc")).toHaveCount(1);

  await page.getByTestId("chat-with-collection").click();
  await expect(page).toHaveURL(/\/chat\?collection=/);
  await expect(page.getByTestId("scope-kind")).toHaveValue("collection");
  // a question about the *other* document finds nothing inside this collection
  await ask(page, "What does multi-head attention let the model do?");
  await expect(page.getByTestId("insufficient-banner")).toBeVisible({ timeout: 30_000 });
  await ask(page, "What do chloroplasts absorb for photosynthesis and glucose light energy?");
  await expect(page.getByTestId("citation-chip").first()).toBeVisible({ timeout: 30_000 });
});

test("settings persist across reload (top-k and theme)", async ({ page }) => {
  await register(page);
  await page.goto("/settings?tab=retrieval");
  await expect(page.getByTestId("topk-value")).toHaveText("8");
  const thumb = page.getByTestId("topk-slider").getByRole("slider");
  await thumb.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("topk-value")).toHaveText("5");
  await page.getByTestId("retrieval-save").click();
  await expect(page.getByText("Retrieval settings saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("topk-value")).toHaveText("5");

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("provider connection test and health tab", async ({ page }) => {
  await register(page);
  await page.goto("/settings?tab=provider");
  await page.getByTestId("test-provider").click();
  await expect(page.getByTestId("test-result")).toContainText("Connected");
  await page.goto("/settings?tab=health");
  await expect(page.getByTestId("health-checks")).toContainText("ready");
});

test("dashboard shows real counts after an upload", async ({ page }) => {
  await register(page);
  await page.goto("/dashboard");
  await expect(page.getByTestId("stat-documents")).toHaveText("0");
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/dashboard");
  await expect(page.getByTestId("stat-documents")).toHaveText("1");
  await expect(page.getByTestId("stat-ready")).toHaveText("1");
  await expect(page.getByTestId("stat-storage")).not.toHaveText("0 B");
});

test("notes: save an answer, find it, export and delete", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  await expect(page.getByTestId("assistant-message").last().getByTestId("save-note")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("save-note").last().click();
  await page.getByTestId("note-title").fill("Chloroplast answer");
  await page.getByTestId("note-tags").fill("bio, light");
  await page.getByTestId("note-save").click();
  await page.goto("/notes");
  await expect(page.getByTestId("note-card-title")).toHaveText("Chloroplast answer");
  await page.getByTestId("note-search").fill("chloroplast");
  await expect(page.getByTestId("note-card")).toHaveCount(1);
  await page.getByTestId("note-delete").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByText("No notes yet").or(page.getByText("No notes match your search"))).toBeVisible();
});

test("mobile navigation opens and navigates", async ({ page }) => {
  await register(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("mobile-nav-button").click();
  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/documents/);
  await expect(page.getByTestId("upload-dropzone")).toBeVisible();
});

test("conversation rename and delete with confirmation", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  await expect(page.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  const item = page.getByTestId("conversation-item").first();
  await item.hover();
  await item.getByRole("button").click();
  await page.getByTestId("conv-rename").click();
  await page.getByTestId("text-dialog-input").fill("Renamed chat");
  await page.getByTestId("text-dialog-submit").click();
  await expect(page.getByTestId("conversation-title").first()).toHaveText("Renamed chat");
  await item.hover();
  await item.getByRole("button").click();
  await page.getByTestId("conv-delete").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("conversation-item")).toHaveCount(0);
});

test("regenerate replaces the answer and follow-up suggestions can be sent", async ({ page }) => {
  await register(page);
  await uploadAndWaitReady(page, "photosynthesis.txt");
  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  await expect(page.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  const chips = page.getByTestId("followup-chip");
  await expect(chips.first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("regenerate").click();
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  await expect(page.getByTestId("assistant-message").first()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(chips.first()).toBeVisible({ timeout: 30_000 });
  await chips.first().click();
  await expect(page.getByTestId("user-message")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("assistant-message")).toHaveCount(2, { timeout: 30_000 });
});

test.afterAll(() => {
  // password constant is shared; nothing to clean (global setup wipes /tmp/ara-e2e on the next run)
  void PASSWORD;
});
