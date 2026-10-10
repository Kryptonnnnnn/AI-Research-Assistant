"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, FolderPlus, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageContainer } from "@/components/shared/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DocMultiSelect } from "@/features/documents/doc-multi-select";
import { StatusBadge } from "@/features/documents/status-badge";
import { useDocuments } from "@/features/documents/hooks";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CollectionOut } from "@/types/api";

import { useCollections } from "./hooks";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

function CollectionFormDialog({ open, onOpenChange, collection }: { open: boolean; onOpenChange: (o: boolean) => void; collection?: CollectionOut | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [seed, setSeed] = useState<string | null>(null);
  const key = collection?.id ?? "new";
  if (open && seed !== key) {
    setSeed(key);
    setName(collection?.name ?? "");
    setDescription(collection?.description ?? "");
  }
  if (!open && seed !== null) setSeed(null);
  const m = useMutation({
    mutationFn: () =>
      collection
        ? api<CollectionOut>(`/collections/${collection.id}`, { method: "PATCH", body: { name: name.trim(), description } })
        : api<CollectionOut>("/collections", { method: "POST", body: { name: name.trim(), description } }),
    onSuccess: () => {
      toast.success(collection ? "Collection updated" : "Collection created");
      qc.invalidateQueries({ queryKey: ["collections"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) m.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{collection ? "Rename collection" : "New collection"}</DialogTitle>
            <DialogDescription>Collections group documents so you can chat with or search just that set.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="col-name">Name</Label>
            <Input id="col-name" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} data-testid="collection-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="col-desc">Description (optional)</Label>
            <Textarea id="col-desc" value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || m.isPending} data-testid="collection-save">
              {m.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CollectionDetail({ collection, onEdit, onDelete }: { collection: CollectionOut; onEdit: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const docs = useDocuments({ collection_id: collection.id, page, page_size: 10 });
  const [toAdd, setToAdd] = useState<string[]>([]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["documents"] });
  };
  const add = useMutation({
    mutationFn: () => api(`/collections/${collection.id}/documents`, { method: "POST", body: { document_ids: toAdd } }),
    onSuccess: () => {
      toast.success("Documents added");
      setToAdd([]);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/collections/${collection.id}/documents`, { method: "DELETE", body: { document_ids: [id] } }),
    onSuccess: () => {
      toast.success("Removed from collection");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Card data-testid="collection-detail">
      <CardHeader>
        <CardTitle className="text-lg">{collection.name}</CardTitle>
        {collection.description && <p className="text-sm text-muted-foreground">{collection.description}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={`/chat?collection=${collection.id}`} className={buttonVariants({ size: "sm" })} data-testid="chat-with-collection">
            <MessageSquare aria-hidden /> Chat with this collection
          </Link>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden /> Rename
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} data-testid="collection-delete">
            <Trash2 aria-hidden /> Delete
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <DocMultiSelect value={toAdd} onChange={setToAdd} placeholder="Add documents…" testId="collection-add-docs" />
          <Button size="sm" disabled={!toAdd.length || add.isPending} onClick={() => add.mutate()} data-testid="collection-add-submit">
            <Plus aria-hidden /> Add {toAdd.length || ""}
          </Button>
        </div>
        {docs.isLoading ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : docs.data?.items.length ? (
          <>
            <ul className="divide-y rounded-lg border">
              {docs.data.items.map((d) => (
                <li key={d.id} className="flex items-center gap-3 p-3 text-sm" data-testid="collection-doc">
                  <Link href={`/documents/${d.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary">
                    {d.title}
                  </Link>
                  <StatusBadge doc={d} />
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${d.title} from collection`} onClick={() => remove.mutate(d.id)}>
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            {docs.data.total > docs.data.page_size && (
              <div className="flex justify-between text-sm">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page * docs.data.page_size >= docs.data.total} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">This collection is empty. Add processed documents above.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function CollectionsView() {
  const qc = useQueryClient();
  const { data, error, isLoading, refetch } = useCollections();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; collection: CollectionOut | null }>({ open: false, collection: null });
  const [del, setDel] = useState<CollectionOut | null>(null);
  const selected = data?.find((c) => c.id === selectedId) ?? data?.[0] ?? null;
  const delM = useMutation({
    mutationFn: () => api(`/collections/${del!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Collection deleted (documents were kept)");
      setDel(null);
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <PageContainer>
      <PageHeader
        title="Collections"
        description="Group related documents, then chat with or search only that set."
        actions={
          <Button onClick={() => setForm({ open: true, collection: null })} data-testid="new-collection">
            <FolderPlus aria-hidden /> New collection
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : !data?.length ? (
        <EmptyState icon={FolderOpen} title="No collections yet" description="Create a collection to organise your documents by project or topic." action={<Button onClick={() => setForm({ open: true, collection: null })}>Create collection</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <ul className="space-y-1" aria-label="Collections" data-testid="collection-list">
            {data.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  aria-current={selected?.id === c.id ? "true" : undefined}
                  data-testid="collection-item"
                  className={cn("flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", selected?.id === c.id ? "border-primary bg-primary/5" : "hover:bg-muted/60")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-medium">{c.name}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.document_count}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <CollectionDetail key={selected.id} collection={selected} onEdit={() => setForm({ open: true, collection: selected })} onDelete={() => setDel(selected)} />}
        </div>
      )}
      <CollectionFormDialog open={form.open} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} collection={form.collection} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this collection?" description={`"${del?.name ?? ""}" will be deleted. The documents inside it are kept in your library.`} pending={delM.isPending} onConfirm={() => delM.mutate()} />
    </PageContainer>
  );
}
