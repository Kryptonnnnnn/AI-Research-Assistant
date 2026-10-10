import { describe, expect, it } from "vitest";

import { checkUploadFile, validatePassword } from "@/lib/validation";

describe("checkUploadFile", () => {
  it.each(["a.pdf", "A.DOCX", "n.txt", "n.md", "n.markdown"])("accepts %s", (name) => {
    expect(checkUploadFile({ name, size: 100 }).ok).toBe(true);
  });
  it("rejects unsupported types, empty and oversized files", () => {
    expect(checkUploadFile({ name: "virus.exe", size: 10 })).toMatchObject({ ok: false, error: expect.stringContaining(".exe") });
    expect(checkUploadFile({ name: "noext", size: 10 }).ok).toBe(false);
    expect(checkUploadFile({ name: "a.txt", size: 0 })).toMatchObject({ ok: false, error: "The file is empty." });
    expect(checkUploadFile({ name: "a.pdf", size: 25 * 1024 * 1024 + 1 }).error).toContain("25 MB");
    expect(checkUploadFile({ name: "a.pdf", size: 25 * 1024 * 1024 }).ok).toBe(true);
  });
});

describe("validatePassword (mirrors the backend rules)", () => {
  it("requires length, mixed case and a digit", () => {
    expect(validatePassword("Short1A")).toMatch(/at least 10/);
    expect(validatePassword("alllowercase123")).toMatch(/upper- and lower-case/);
    expect(validatePassword("NoDigitsHereAtAll")).toMatch(/number/);
    expect(validatePassword("Str0ngPassw0rd!")).toBeNull();
  });
});

import { formatBytes, parseDate, timeAgo } from "@/lib/format";

describe("format helpers", () => {
  it("treats timezone-naive API timestamps as UTC", () => {
    expect(parseDate("2026-01-01T10:00:00").toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect(parseDate("2026-01-01T10:00:00+02:00").toISOString()).toBe("2026-01-01T08:00:00.000Z");
    expect(parseDate("2026-01-01T10:00:00Z").toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString().replace("Z", ""))).toBe("5m ago");
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
});
