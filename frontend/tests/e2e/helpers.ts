import { expect, type Page } from "@playwright/test";
import path from "node:path";

export const PASSWORD = "Str0ngPassw0rd!";
export const fixture = (name: string) => path.join(__dirname, "fixtures", name);
let counter = 0;
export const uniqueEmail = (tag = "u") => `${tag}-${Date.now()}-${counter++}@example.com`;

export async function register(page: Page, email = uniqueEmail(), name = "E2E User") {
  await page.goto("/register");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByTestId("auth-submit").click();
  await page.waitForURL("**/dashboard");
  return email;
}

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByTestId("auth-submit").click();
  await page.waitForURL("**/dashboard");
}

export async function logout(page: Page) {
  await page.getByTestId("user-menu").click();
  await page.getByTestId("logout").click();
  await page.waitForURL("**/login");
}

/** Upload a fixture through the dropzone and wait until the document shows as Ready. */
export async function uploadAndWaitReady(page: Page, file: string) {
  await page.goto("/documents");
  await page.getByTestId("file-input").setInputFiles(fixture(file));
  const row = page.getByTestId("doc-row").first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId("doc-status")).toContainText("Ready", { timeout: 30_000 });
  return row;
}

export async function ask(page: Page, question: string) {
  await page.getByTestId("chat-input").fill(question);
  await page.getByTestId("chat-send").click();
}
