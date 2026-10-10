/** The API returns timezone-naive ISO strings when backed by SQLite; treat those as UTC. */
export function parseDate(iso: string): Date {
  return new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  return parseDate(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  return parseDate(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - parseDate(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(iso);
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  reading: "Reading file",
  extracting: "Extracting text",
  chunking: "Splitting into chunks",
  embedding: "Creating embeddings",
  indexing: "Indexing",
  retrying: "Retrying",
  recovered: "Resuming",
  done: "Ready",
  failed: "Failed",
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

export function retrievalModeLabel(mode: string | undefined): string | null {
  if (mode === "semantic") return "Semantic vector search";
  if (mode === "lexical") return "Lexical (keyword-like) matching";
  return null;
}
