"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, CopyCheck, Loader2, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_MB } from "@/lib/validation";
import type { UploadItem } from "@/types/api";

import { friendlyUploadError, uploadFiles } from "./upload";

export function UploadZone() {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadItem[]>([]);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      try {
        const items = await uploadFiles(files);
        setResults(items);
        const created = items.filter((i) => i.status === "created").length;
        if (created) toast.success(`${created} file${created > 1 ? "s" : ""} uploaded — processing started`);
        else toast.error("No files were added. See details below.");
        await qc.invalidateQueries({ queryKey: ["documents"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      } catch (e) {
        toast.error(friendlyUploadError(e));
      } finally {
        setUploading(false);
      }
    },
    [qc],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: true,
    disabled: uploading,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        data-testid="upload-dropzone"
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-4 text-center transition-colors sm:flex-row sm:text-left",
          isDragActive ? "border-primary bg-primary/5" : "border-border bg-muted/30",
        )}
      >
        <input {...getInputProps({ "data-testid": "file-input", "aria-label": "Choose files to upload" })} accept={ALLOWED_EXTENSIONS.join(",")} />
        {uploading ? <Loader2 className="size-8 shrink-0 animate-spin text-primary" aria-hidden /> : <UploadCloud className="size-8 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{uploading ? "Uploading…" : isDragActive ? "Drop to upload" : "Drag & drop files here"}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            PDF, DOCX, TXT or Markdown · up to {MAX_UPLOAD_MB} MB each · multiple files supported
          </p>
        </div>
        <Button variant="outline" onClick={open} disabled={uploading} data-testid="browse-files">
          Browse files
        </Button>
      </div>
      {results.length > 0 && (
        <div className="rounded-xl border p-3" data-testid="upload-results" aria-live="polite">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Upload results</h3>
            <Button variant="ghost" size="icon-sm" aria-label="Dismiss results" onClick={() => setResults([])}>
              <X aria-hidden />
            </Button>
          </div>
          <ul className="space-y-1.5">
            {results.map((r, i) => (
              <li key={`${r.filename}-${i}`} className="flex items-start gap-2 text-sm" data-testid="upload-result" data-status={r.status}>
                {r.status === "created" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                ) : r.status === "duplicate" ? (
                  <CopyCheck className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                ) : (
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="font-medium">{r.filename}</span>{" "}
                  <span className="text-muted-foreground">
                    {r.status === "created" && "— uploaded, processing"}
                    {r.status === "duplicate" && (
                      <>
                        — already in your library{" "}
                        {r.existing_document_id && (
                          <Link className="text-primary underline" href={`/documents/${r.existing_document_id}`}>
                            view
                          </Link>
                        )}
                      </>
                    )}
                    {r.status === "rejected" && `— ${r.error}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
