import { describe, expect, it, vi } from "vitest";

import { uploadFiles } from "@/features/documents/upload";

const file = (name: string, size = 10) => new File([new Uint8Array(size).fill(65)], name);
const doc = { id: "d1", title: "a" };

describe("uploadFiles", () => {
  it("rejects invalid files client-side without a request and keeps result order", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ items: [{ filename: "ok.txt", status: "created", document: doc }] }), { status: 201 }));
    const res = await uploadFiles([file("bad.exe"), file("ok.txt")], f as unknown as typeof fetch);
    expect(res.map((r) => r.status)).toEqual(["rejected", "created"]);
    expect(res[0].error).toContain("Unsupported");
    expect(f).toHaveBeenCalledTimes(1);
    const form = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("returns per-file results from 409 (all duplicates) responses instead of throwing", async () => {
    const body = { items: [{ filename: "a.txt", status: "duplicate", existing_document_id: "d9", error: "You have already uploaded this exact file." }] };
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 409 }));
    const res = await uploadFiles([file("a.txt")], f as unknown as typeof fetch);
    expect(res[0]).toMatchObject({ status: "duplicate", existing_document_id: "d9" });
  });

  it("throws an ApiError for non-upload error responses", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: "too_many_files", message: "too many" } }), { status: 422 }));
    await expect(uploadFiles([file("a.txt")], f as unknown as typeof fetch)).rejects.toMatchObject({ code: "too_many_files" });
  });

  it("batches uploads of more than 10 files", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const n = (init.body as FormData).getAll("files").length;
      return new Response(JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ filename: `f${i}`, status: "created", document: doc })) }), { status: 201 });
    });
    const res = await uploadFiles(Array.from({ length: 12 }, (_, i) => file(`f${i}.txt`)), f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
    expect(res).toHaveLength(12);
  });
});
