"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/states";
import { TextDialog } from "@/components/shared/text-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConversationOut, Page } from "@/types/api";

const SIZE = 30;

export function ConversationList({ activeId, onNavigate, onDeleted }: { activeId: string | null; onNavigate?: () => void; onDeleted?: (id: string) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useInfiniteQuery({
    queryKey: ["conversations", dq],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Page<ConversationOut>>("/conversations", { query: { q: dq || undefined, page: pageParam, page_size: SIZE } }),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const [rename, setRename] = useState<ConversationOut | null>(null);
  const [del, setDel] = useState<ConversationOut | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["conversation"] });
  };
  const renameM = useMutation({
    mutationFn: (title: string) => api(`/conversations/${rename!.id}`, { method: "PATCH", body: { title } }),
    onSuccess: () => {
      toast.success("Conversation renamed");
      invalidate();
      setRename(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Rename failed"),
  });
  const delM = useMutation({
    mutationFn: () => api(`/conversations/${del!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Conversation deleted");
      const id = del!.id;
      invalidate();
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setDel(null);
      onDeleted?.(id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Delete failed"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Link href="/chat" onClick={onNavigate} className={cn(buttonVariants(), "w-full")} data-testid="new-chat">
        <Plus aria-hidden /> New conversation
      </Link>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search conversations" placeholder="Search chats…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} data-testid="conversation-search" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="conversation-list">
        {list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{dq ? "No conversations match your search." : "No conversations yet. Ask your first question!"}</p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((c) => (
              <li key={c.id} className="group relative" data-testid="conversation-item">
                <Link
                  href={`/chat/${c.id}`}
                  onClick={onNavigate}
                  aria-current={activeId === c.id ? "page" : undefined}
                  className={cn("block rounded-lg px-3 py-2 pr-9 outline-none focus-visible:ring-2 focus-visible:ring-ring", activeId === c.id ? "bg-muted" : "hover:bg-muted/60")}
                >
                  <span className="flex items-center gap-2">
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate text-sm font-medium" data-testid="conversation-title">{c.title}</span>
                  </span>
                  <span className="mt-0.5 block truncate pl-5.5 text-xs text-muted-foreground">
                    {timeAgo(c.updated_at)} · {c.message_count} msgs
                  </span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.title}`} className="absolute top-2 right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100" />}>
                    <MoreHorizontal aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRename(c)} data-testid="conv-rename">
                      <Pencil aria-hidden /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDel(c)} data-testid="conv-delete">
                      <Trash2 aria-hidden /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
      <TextDialog open={!!rename} onOpenChange={(o) => !o && setRename(null)} title="Rename conversation" label="Title" initial={rename?.title ?? ""} pending={renameM.isPending} onSubmit={(v) => renameM.mutate(v)} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this conversation?" description="All messages in this conversation will be permanently deleted. Saved notes are not affected." pending={delM.isPending} onConfirm={() => delM.mutate()} />
    </div>
  );
}
