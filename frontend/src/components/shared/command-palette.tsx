"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText, MessageSquare, MoonStar, Plus, Settings, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";

import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { fileTypeMeta } from "@/lib/file-types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ConversationOut, DocumentOut, Page } from "@/types/api";

import type { NavItem } from "./nav";

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ⌘K / Ctrl+K palette: jump to pages, run actions, and search the user's documents and conversations (live, server-side). */
export function CommandPalette({
  open,
  onOpenChange,
  nav,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: NavItem[];
  onUpload: () => void;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const docs = useQuery({
    queryKey: ["palette", "documents", q],
    enabled: open,
    queryFn: () => api<Page<DocumentOut>>("/documents", { query: { q: q || undefined, page_size: 5, sort: "newest" } }),
    staleTime: 10_000,
  });
  const convs = useQuery({
    queryKey: ["palette", "conversations", q],
    enabled: open,
    queryFn: () => api<Page<ConversationOut>>("/conversations", { query: { q: q || undefined, page_size: 5 } }),
    staleTime: 10_000,
  });

  const lower = query.trim().toLowerCase();
  const pages = useMemo(() => nav.filter((n) => !lower || n.label.toLowerCase().includes(lower)), [nav, lower]);
  const actions = useMemo(
    () =>
      [
        { id: "upload", label: "Upload documents", icon: Upload, run: onUpload },
        { id: "new-chat", label: "New conversation", icon: Plus, run: () => router.push("/chat") },
        { id: "theme", label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: MoonStar, run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") },
        { id: "settings", label: "Open settings", icon: Settings, run: () => router.push("/settings") },
      ].filter((a) => !lower || a.label.toLowerCase().includes(lower)),
    [lower, onUpload, resolvedTheme, router, setTheme],
  );

  const go = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Jump to a page, run an action, or search your documents and conversations." className="sm:max-w-xl">
      <Command shouldFilter={false} data-testid="command-palette">
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search pages, documents, conversations…" data-testid="palette-input" />
        <CommandList className="max-h-96">
          <CommandEmpty>{docs.isFetching || convs.isFetching ? "Searching…" : "No results."}</CommandEmpty>
          {pages.length > 0 && (
            <CommandGroup heading="Pages">
              {pages.map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} value={`page-${href}`} onSelect={go(() => router.push(href))} data-testid="palette-page">
                  <Icon aria-hidden /> {label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {actions.length > 0 && (
            <CommandGroup heading="Actions">
              {actions.map(({ id, label, icon: Icon, run }) => (
                <CommandItem key={id} value={`action-${id}`} onSelect={go(run)} data-testid={`palette-action-${id}`}>
                  <Icon aria-hidden /> {label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {docs.data && docs.data.items.length > 0 && (
            <CommandGroup heading={q ? "Documents" : "Recent documents"}>
              {docs.data.items.map((d) => {
                const meta = fileTypeMeta(d.file_ext);
                return (
                  <CommandItem key={d.id} value={`doc-${d.id}`} onSelect={go(() => router.push(`/documents/${d.id}`))} data-testid="palette-document">
                    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded", meta.tile)}>
                      <FileText className="size-3.5" aria-hidden />
                    </span>
                    <span className="truncate">{d.title}</span>
                    <CommandShortcut>{meta.label}</CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {convs.data && convs.data.items.length > 0 && (
            <CommandGroup heading={q ? "Conversations" : "Recent conversations"}>
              {convs.data.items.map((c) => (
                <CommandItem key={c.id} value={`conv-${c.id}`} onSelect={go(() => router.push(`/chat/${c.id}`))} data-testid="palette-conversation">
                  <MessageSquare aria-hidden />
                  <span className="truncate">{c.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
