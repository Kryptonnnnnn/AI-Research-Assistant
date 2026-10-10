export const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown"] as const;
export const MAX_UPLOAD_MB = 25;
export const MAX_FILES = 10;

export interface FileCheck {
  ok: boolean;
  error?: string;
}

/** Client-side pre-check; the server re-validates everything (extension, MIME, signature, size). */
export function checkUploadFile(file: { name: string; size: number }): FileCheck {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: `Unsupported file type "${ext || "none"}". Allowed: PDF, DOCX, TXT, Markdown.` };
  }
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return { ok: false, error: `File exceeds the ${MAX_UPLOAD_MB} MB limit.` };
  }
  return { ok: true };
}

/** Mirrors backend auth_service.validate_password_strength (min length 10, mixed case, a digit). */
export function validatePassword(pw: string, minLength = 10): string | null {
  if (pw.length < minLength) return `Password must be at least ${minLength} characters.`;
  if (pw.toLowerCase() === pw || !/\d/.test(pw)) {
    return "Password must mix upper- and lower-case letters and include at least one number.";
  }
  return null;
}
