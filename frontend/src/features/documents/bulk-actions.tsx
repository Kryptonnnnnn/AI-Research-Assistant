"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCollections } from "@/features/collections/hooks";
import { api, ApiError } from "@/lib/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

/** Run one request per id, never aborting the batch; report how many succeeded and how many failed. */
export async function runBatch(ids: string[], fn: (id: string) => Promise<unknown>): Promise<{ ok: number; failed: number }> {
  const results = await Promise.allSettled(ids.map(fn));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  return { ok, failed: results.length - ok };
}

export function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const qc = useQueryClient();
  const [assign, setAssign] = useState(false);
  const [del, setDel] = useState(false);
  const invalidate = () => {
    for (const k of ["documents", "document", "collections", "dashboard"]) qc.invalidateQueries({ queryKey: [k] });
  };

  const reprocess = useMutation({
    mutationFn: () => runBatch(ids, (id) => api(`/documents/${id}/reprocess`, { method: "POST", body: {} })),
    onSuccess: ({ ok, failed }) => {
      if (ok) toast.success(`Reprocessing started for ${ok} document${ok > 1 ? "s" : ""}`);
      if (failed) toast.error(`${failed} could not be reprocessed (already processing?)`);
      invalidate();
      onClear();
    },
  });
  const remove = useMutation({
    mutationFn: () => runBatch(ids, (id) => api(`/documents/${id}`, { method: "DELETE" })),
    onSuccess: ({ ok, failed }) => {
      if (ok) toast.success(`Deleted ${ok} document${ok > 1 ? "s" : ""}`);
      if (failed) toast.error(`${failed} could not be deleted`);
      invalidate();
      setDel(false);
      onClear();
    },
  });

  return (
    <div role="toolbar" aria-label="Bulk actions" className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-sm" data-testid="bulk-bar">
      <span className="text-sm font-medium" data-testid="bulk-count">
        {ids.length} selected
      </span>
      <Button size="sm" variant="outline" onClick={() => setAssign(true)} data-testid="bulk-assign">
        <FolderPlus aria-hidden /> Add to collection
      </Button>
      <Button size="sm" variant="outline" onClick={() => reprocess.mutate()} disabled={reprocess.isPending} data-testid="bulk-reprocess">
        <RefreshCw aria-hidden /> Reprocess
      </Button>
      <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDel(true)} data-testid="bulk-delete">
        <Trash2 aria-hidden /> Delete
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear} aria-label="Clear selection">
        <X aria-hidden /> Clear
      </Button>
      <BulkCollectionDialog open={assign} onOpenChange={setAssign} ids={ids} onDone={() => (invalidate(), onClear())} />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={`Delete ${ids.length} document${ids.length > 1 ? "s" : ""}?`}
        description="Their files, extracted text and embeddings are permanently removed. Past answers keep their saved citation snapshots."
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function BulkCollectionDialog({ open, onOpenChange, ids, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; ids: string[]; onDone: () => void }) {
  const { data: collections, isLoading } = useCollections();
  const [target, setTarget] = useState("");
  const chosen = target || collections?.[0]?.id || "";
  const m = useMutation({
    mutationFn: () => api(`/collections/${chosen}/documents`, { method: "POST", body: { document_ids: ids } }),
    onSuccess: () => {
      toast.success(`Added ${ids.length} document${ids.length > 1 ? "s" : ""} to the collection`);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error(msg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to collection</DialogTitle>
          <DialogDescription>
            {ids.length} document{ids.length > 1 ? "s" : ""} will be added. Existing memberships are kept.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : collections?.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="bulk-collection">Collection</Label>
            <NativeSelect id="bulk-collection" className="w-full" value={chosen} onChange={(e) => setTarget(e.target.value)} data-testid="bulk-collection-select">
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.document_count})
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No collections yet. Create one on the Collections page first.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!chosen || m.isPending} onClick={() => m.mutate()} data-testid="bulk-assign-save">
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
