export const qk = {
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  documents: (p?: unknown) => ["documents", p ?? {}] as const,
  document: (id: string) => ["document", id] as const,
  chunks: (id: string, page?: number | null) => ["chunks", id, page ?? null] as const,
  jobs: (p?: unknown) => ["jobs", p ?? {}] as const,
  collections: ["collections"] as const,
  conversations: (q?: string) => ["conversations", q ?? ""] as const,
  conversation: (id: string) => ["conversation", id] as const,
  notes: (p?: unknown) => ["notes", p ?? {}] as const,
  settings: ["settings"] as const,
  ready: ["ready"] as const,
};
