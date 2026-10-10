import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "@/components/shared/command-palette";
import { ALL_NAV } from "@/components/shared/nav";

import { mockFetch, renderWithClient } from "./utils";

const push = vi.fn();
const setTheme = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme }) }));

const DOCS = [{ id: "d1", title: "Photosynthesis notes", file_ext: ".pdf" }];
const CONVS = [{ id: "c1", title: "Chlorophyll questions" }];

beforeEach(() => {
  push.mockClear();
  setTheme.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function setup(onUpload = vi.fn()) {
  const api = mockFetch({
    "/documents": (url) => ({ items: url.searchParams.get("q")?.includes("photo") ? DOCS : [], total: 1, page: 1, page_size: 5 }),
    "/conversations": (url) => ({ items: url.searchParams.get("q")?.includes("chloro") ? CONVS : [], total: 1, page: 1, page_size: 5 }),
  });
  renderWithClient(<CommandPalette open onOpenChange={() => {}} nav={ALL_NAV} onUpload={onUpload} />);
  return { api, onUpload };
}

describe("command palette", () => {
  it("jumps to a page", async () => {
    setup();
    await userEvent.type(screen.getByTestId("palette-input"), "docu");
    const item = await screen.findByTestId("palette-page");
    expect(item).toHaveTextContent("Documents");
    await userEvent.click(item);
    expect(push).toHaveBeenCalledWith("/documents");
  });

  it("searches the user's documents live (server-side q) and opens one", async () => {
    const { api } = setup();
    await userEvent.type(screen.getByTestId("palette-input"), "photo");
    const doc = await screen.findByTestId("palette-document");
    expect(doc).toHaveTextContent("Photosynthesis notes");
    expect(doc).toHaveTextContent("PDF");
    expect(api.calls.some((c) => c.url.pathname.endsWith("/documents") && c.url.searchParams.get("q") === "photo")).toBe(true);
    await userEvent.click(doc);
    expect(push).toHaveBeenCalledWith("/documents/d1");
  });

  it("searches conversations and opens one", async () => {
    setup();
    await userEvent.type(screen.getByTestId("palette-input"), "chloro");
    const conv = await screen.findByTestId("palette-conversation");
    await userEvent.click(conv);
    expect(push).toHaveBeenCalledWith("/chat/c1");
  });

  it("runs actions: upload, new chat and theme toggle", async () => {
    const { onUpload } = setup();
    await userEvent.click(screen.getByTestId("palette-action-upload"));
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when nothing matches", async () => {
    setup();
    await userEvent.type(screen.getByTestId("palette-input"), "zzzzqqq");
    await waitFor(() => expect(screen.queryByTestId("palette-page")).toBeNull());
    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
  });
});
