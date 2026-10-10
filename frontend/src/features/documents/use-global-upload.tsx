"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { ALLOWED_EXTENSIONS } from "@/lib/validation";

import { friendlyUploadError, uploadFiles } from "./upload";

/** Upload from anywhere in the app (toolbar button / command palette). Opens a native file picker. */
export function useGlobalUpload() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      try {
        const items = await uploadFiles(files);
        const created = items.filter((i) => i.status === "created").length;
        const dupes = items.filter((i) => i.status === "duplicate").length;
        const rejected = items.filter((i) => i.status === "rejected");
        if (created) toast.success(`${created} file${created > 1 ? "s" : ""} uploaded — indexing started`);
        if (dupes) toast.info(`${dupes} file${dupes > 1 ? "s were" : " was"} already in your library`);
        if (rejected.length) toast.error(rejected[0].error ?? "A file was rejected", { description: rejected.length > 1 ? `${rejected.length} files were rejected.` : undefined });
        await Promise.all([qc.invalidateQueries({ queryKey: ["documents"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })]);
        if (created && !pathname.startsWith("/documents")) router.push("/documents");
      } catch (e) {
        toast.error(friendlyUploadError(e));
      } finally {
        setUploading(false);
      }
    },
    [pathname, qc, router],
  );

  const pick = useCallback(() => input.current?.click(), []);

  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      accept={ALLOWED_EXTENSIONS.join(",")}
      aria-label="Choose files to upload"
      data-testid="global-file-input"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        void handleFiles(files);
      }}
    />
  );
  return { pick, picker, uploading };
}
