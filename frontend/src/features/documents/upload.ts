import { parseError } from "@/lib/api";
import { checkUploadFile, MAX_FILES } from "@/lib/validation";
import type { UploadItem, UploadResponse } from "@/types/api";

/** Upload files (pre-validated client-side, then in batches). Returns one result per file, in input order. */
export async function uploadFiles(files: File[], fetchImpl: typeof fetch = fetch): Promise<UploadItem[]> {
  const results: UploadItem[] = new Array(files.length);
  const toSend: Array<{ file: File; index: number }> = [];
  files.forEach((file, index) => {
    const check = checkUploadFile(file);
    if (check.ok) toSend.push({ file, index });
    else results[index] = { filename: file.name, status: "rejected", document: null, existing_document_id: null, error: check.error ?? "Invalid file", error_code: "client_validation" };
  });
  for (let i = 0; i < toSend.length; i += MAX_FILES) {
    const batch = toSend.slice(i, i + MAX_FILES);
    const form = new FormData();
    batch.forEach(({ file }) => form.append("files", file, file.name));
    const res = await fetchImpl("/api/v1/documents/upload", { method: "POST", body: form, credentials: "same-origin" });
    // 201 (some created), 409 (all duplicates) and 422 (all rejected) all carry an UploadResponse body.
    let body: UploadResponse | null = null;
    try {
      const json = await res.clone().json();
      if (json && Array.isArray(json.items)) body = json as UploadResponse;
    } catch {
      /* fall through */
    }
    if (!body) throw await parseError(res);
    batch.forEach(({ index }, k) => (results[index] = body!.items[k]));
  }
  return results;
}
