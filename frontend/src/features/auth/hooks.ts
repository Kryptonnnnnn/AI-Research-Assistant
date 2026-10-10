"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { User } from "@/types/api";

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api<User>("/auth/me"), staleTime: 60_000 });
}
