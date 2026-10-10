import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseTags, SaveNoteDialog } from "@/features/notes/save-note-dialog";

function setup(props: Partial<React.ComponentProps<typeof SaveNoteDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SaveNoteDialog open onOpenChange={onOpenChange} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onSaved };
}

describe("SaveNoteDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses tags", () => {
    expect(parseTags(" a, b ,, c ")).toEqual(["a", "b", "c"]);
  });

  it("disables saving until title and content are present", async () => {
    setup();
    const save = screen.getByTestId("note-save");
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByTestId("note-title"), "T");
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByTestId("note-content"), "Body");
    expect(save).toBeEnabled();
  });

  it("posts the note with tags and the source message id", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "n1", title: "My note" }), { status: 201 }));
    vi.stubGlobal("fetch", f);
    const { onSaved, onOpenChange } = setup({ defaultTitle: "My note", content: "Answer [S1]", sourceMessageId: "msg-1" });
    await userEvent.type(screen.getByTestId("note-tags"), "bio, light");
    await userEvent.click(screen.getByTestId("note-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/notes");
    expect(JSON.parse(init.body as string)).toEqual({ title: "My note", content: "Answer [S1]", source_message_id: "msg-1", tags: ["bio", "light"] });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
