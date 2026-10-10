import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ask, fixture, register } from "./helpers";

// Opt-in: SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture UI screenshots");

const OUT = path.resolve(__dirname, "../../screenshots");
const backendPy = path.resolve(__dirname, "../../../backend/.venv/bin/python");

function makeScannedPdf(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ara-shot-"));
  const script = `
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
cv = canvas.Canvas(sys.argv[1], pagesize=A4)
cv.rect(50, 50, 300, 300, fill=1)
cv.showPage(); cv.save()
`;
  writeFileSync(path.join(dir, "gen.py"), script);
  const file = path.join(dir, "scanned-lecture.pdf");
  execFileSync(backendPy, ["-I", path.join(dir, "gen.py"), file]);
  return file;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(350); // let transitions settle
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
}

test("capture the redesigned workspace", async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await register(page, undefined, "Ada Researcher");

  // --- seed real data: three good documents and one that fails (image-only PDF)
  await page.goto("/documents");
  await page.getByTestId("file-input").setInputFiles([fixture("plants.pdf"), fixture("photosynthesis.txt"), fixture("transformers.txt"), makeScannedPdf()]);
  await expect(page.getByTestId("doc-status").filter({ hasText: "Ready" })).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByTestId("doc-status").filter({ hasText: "Failed" })).toHaveCount(1, { timeout: 60_000 });

  // --- chat with a citation and a docked viewer
  await page.goto("/chat");
  await ask(page, "How do chloroplasts absorb light for glucose?");
  await expect(page.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await expect(page.getByTestId("followup-chip").first()).toBeVisible({ timeout: 30_000 });
  await ask(page, "What does multi-head attention let the model do?");
  await expect(page.getByTestId("assistant-message")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
  await shot(page, "desktop-chat-closed");
  await page.getByTestId("assistant-message").first().getByTestId("citation-chip").first().click();
  await expect(page.getByTestId("evidence-panel")).toBeVisible();
  await shot(page, "desktop-viewer-pane");
  await page.getByTestId("viewer-tab-document").click();
  await page.waitForTimeout(500);
  await shot(page, "desktop-viewer-document");
  await page.getByTestId("viewer-tab-evidence").click();

  // dark
  await setTheme(page, "dark");
  await shot(page, "desktop-viewer-pane-dark");
  await setTheme(page, "light");

  // --- a second conversation exists for the history column
  await page.getByTestId("viewer-close").click();
  await page.getByTestId("new-chat").click();
  await ask(page, "Where do the sources disagree?");
  await expect(page.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });

  // --- dashboard
  await page.goto("/dashboard");
  await expect(page.getByTestId("recent-document").first()).toBeVisible();
  await shot(page, "desktop-dashboard");
  await setTheme(page, "dark");
  await shot(page, "desktop-dashboard-dark");
  await setTheme(page, "light");

  // --- documents: list, grid, bulk selection
  await page.goto("/documents");
  await shot(page, "desktop-documents");
  await page.getByTestId("view-grid").click();
  await shot(page, "desktop-documents-grid");
  await page.getByTestId("doc-select").first().click({ force: true });
  await page.getByTestId("doc-select").nth(1).click({ force: true });
  await shot(page, "desktop-documents-grid-selected");
  await setTheme(page, "dark");
  await shot(page, "desktop-documents-grid-dark");
  await setTheme(page, "light");
  await page.getByTestId("view-list").click();

  // --- command palette
  await page.keyboard.press("ControlOrMeta+K");
  await page.getByTestId("palette-input").fill("photo");
  await expect(page.getByTestId("palette-document").first()).toBeVisible();
  await shot(page, "desktop-command-palette");
  await page.keyboard.press("Escape");

  // --- research: conflicts across two documents
  await page.goto("/research");
  await page.getByTestId("tab-conflicts").click();
  await page.getByTestId("research-docs-conflicts").click();
  await page.getByRole("checkbox", { name: "photosynthesis" }).click();
  await page.getByRole("checkbox", { name: "transformers" }).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("run-conflicts").click();
  await expect(page.getByTestId("task-result")).toBeVisible({ timeout: 30_000 });
  await shot(page, "desktop-research");

  // --- settings
  await page.goto("/settings?tab=provider");
  await expect(page.getByTestId("model-input")).toBeVisible();
  await shot(page, "desktop-settings");
  await page.goto("/settings?tab=health");
  await expect(page.getByTestId("health-checks")).toBeVisible();
  await shot(page, "desktop-settings-health");
  await page.goto("/search");
  await shot(page, "desktop-search");

  // --- tablet
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/dashboard");
  await shot(page, "tablet-dashboard");
  await page.goto("/documents");
  await page.getByTestId("view-grid").click();
  await shot(page, "tablet-documents-grid");
  await page.goto("/chat");
  await page.getByTestId("open-conversations").click();
  await shot(page, "tablet-chat-drawer");
  await page.getByTestId("conversation-item").filter({ hasText: "chloroplasts" }).getByRole("link").click();
  await expect(page.getByTestId("assistant-message").first()).toBeVisible();
  await shot(page, "tablet-chat");
  await page.getByTestId("citation-chip").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "tablet-viewer-sheet");

  // --- mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await shot(page, "mobile-dashboard");
  await page.goto("/documents");
  await page.getByTestId("view-list").click();
  await shot(page, "mobile-documents");
  await page.goto("/chat");
  await page.getByTestId("open-conversations").click();
  await shot(page, "mobile-chat-drawer");
  await page.getByTestId("conversation-item").filter({ hasText: "chloroplasts" }).getByRole("link").click();
  await expect(page.getByTestId("assistant-message").first()).toBeVisible();
  await shot(page, "mobile-chat");
  await page.getByTestId("citation-chip").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "mobile-viewer-sheet");
  await setTheme(page, "dark");
  await shot(page, "mobile-viewer-sheet-dark");
});
