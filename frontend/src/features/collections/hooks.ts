"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { CollectionOut } from "@/types/api";

export function useCollections() {
  return useQuery({ queryKey: qk.collections, queryFn: () => api<CollectionOut[]>("/collections") });
}
