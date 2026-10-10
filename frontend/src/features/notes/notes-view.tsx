"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageContainer } from "@/components/shared/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/features/chat/markdown";
import { Pager } from "@/features/documents/documents-view";
import { api, ApiError, downloadFromApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { NoteOut, Page } from "@/types/api";

import { parseTags, SaveNoteDialog } from "./save-note-dialog";

function EditNoteDialog({ note, onClose }: { note: NoteOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
      setTags(note.tags.join(", "));
    }
  }, [note]);
  const m = useMutation({
    mutationFn: () => api(`/notes/${note!.id}`, { method: "PATCH", body: { title: title.trim(), content, tags: parseTags(tags) } }),
    onSuccess: () => {
      toast.success("Note updated");
      qc.invalidateQueries({ queryKey: ["notes"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Update failed"),
  });
  return (
    <Dialog open={!!note} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && content.trim()) m.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit note</DialogTitle>
            <DialogDescription>Saved citations stay attached to the note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} data-testid="edit-note-title" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-content">Content</Label>
            <Textarea id="edit-content" rows={10} value={content} onChange={(e) => setContent(e.target.value)} data-testid="edit-note-content" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-tags">Tags (comma separated)</Label>
            <Input id="edit-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={m.isPending || !title.trim() || !content.trim()} data-testid="edit-note-save">
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NotesView() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<NoteOut | null>(null);
  const [del, setDel] = useState<NoteOut | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setDq(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: qk.notes({ dq, page }),
    queryFn: () => api<Page<NoteOut>>("/notes", { query: { q: dq || undefined, page, page_size: 10 } }),
  });
  const delM = useMutation({
    mutationFn: () => api(`/notes/${del!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Note deleted");
      setDel(null);
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Delete failed"),
  });
  return (
    <PageContainer>
      <PageHeader
        title="Saved notes"
        description="Answers and excerpts you've kept, with their citations."
        actions={
          <Button onClick={() => setCreate(true)} data-testid="new-note">
            <Plus aria-hidden /> New note
          </Button>
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search notes" placeholder="Search notes…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} data-testid="note-search" />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : !data?.items.length ? (
        <EmptyState icon={BookMarked} title={dq ? "No notes match your search" : "No notes yet"} description={dq ? undefined : "Use “Save to notes” on any answer, or create one here."} action={!dq ? <Button onClick={() => setCreate(true)}>Create a note</Button> : undefined} />
      ) : (
        <>
          <ul className="space-y-4" data-testid="note-list">
            {data.items.map((n) => (
              <li key={n.id}>
                <Card data-testid="note-card">
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="font-semibold" data-testid="note-card-title">{n.title}</h2>
                        <p className="text-xs text-muted-foreground">Updated {formatDate(n.updated_at)}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${n.title}`} onClick={() => setEdit(n)} data-testid="note-edit">
                          <Pencil aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Export ${n.title} as Markdown`} onClick={() => downloadFromApi(`/notes/${n.id}/export`, "note.md").catch(() => toast.error("Export failed"))} data-testid="note-export">
                          <Download aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${n.title}`} onClick={() => setDel(n)} data-testid="note-delete">
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      <Markdown content={n.content} />
                    </div>
                    {n.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {n.tags.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {n.citations.length > 0 && (
                      <details className="rounded-lg border p-2 text-sm">
                        <summary className="cursor-pointer font-medium">Saved citations ({n.citations.length})</summary>
                        <ul className="mt-2 space-y-2">
                          {n.citations.map((c, i) => (
                            <li key={i}>
                              <Badge variant="outline" className="mr-1.5">{c.label}</Badge>
                              {c.document_id ? (
                                <Link href={`/documents/${c.document_id}${c.page_number ? `?page=${c.page_number}` : ""}`} className="font-medium text-primary hover:underline">
                                  {c.document_title}
                                </Link>
                              ) : (
                                <span className="font-medium">{c.document_title}</span>
                              )}
                              {c.page_number ? <span className="text-muted-foreground"> · p.{c.page_number}</span> : null}
                              <p className="mt-0.5 text-muted-foreground">“{c.excerpt}”</p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
      <SaveNoteDialog open={create} onOpenChange={setCreate} />
      <EditNoteDialog note={edit} onClose={() => setEdit(null)} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this note?" description={`"${del?.title ?? ""}" will be permanently deleted.`} pending={delM.isPending} onConfirm={() => delM.mutate()} />
    </PageContainer>
  );
}
