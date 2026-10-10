"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { DocumentOut, Page } from "@/types/api";

export interface DocFilters {
  page?: number;
  page_size?: number;
  status?: string;
  collection_id?: string;
  q?: string;
  sort?: string;
}

export function useDocuments(filters: DocFilters, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: qk.documents(filters),
    queryFn: () => api<Page<DocumentOut>>("/documents", { query: { page_size: 20, ...filters } }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => {
      if (opts.poll === false) return false;
      const items = q.state.data?.items ?? [];
      return items.some((d) => d.status === "queued" || d.status === "processing") ? 2000 : false;
    },
  });
}

/** Ready documents for pickers (bounded: first 100). */
export function useReadyDocuments() {
  return useQuery({
    queryKey: qk.documents({ status: "ready", page_size: 100, sort: "title", picker: true }),
    queryFn: () => api<Page<DocumentOut>>("/documents", { query: { status: "ready", page_size: 100, sort: "title" } }),
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: qk.document(id),
    queryFn: () => api<DocumentOut>(`/documents/${id}`),
    refetchInterval: (q) => (q.state.data && ["queued", "processing"].includes(q.state.data.status) ? 2000 : false),
  });
}
