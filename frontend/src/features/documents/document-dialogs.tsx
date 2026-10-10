"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TextDialog } from "@/components/shared/text-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCollections } from "@/features/collections/hooks";
import { api, ApiError } from "@/lib/api";
import type { DocumentOut } from "@/types/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["document"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

export function RenameDocumentDialog({ doc, onClose }: { doc: DocumentOut | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const m = useMutation({
    mutationFn: (title: string) => api(`/documents/${doc!.id}`, { method: "PATCH", body: { title } }),
    onSuccess: () => {
      toast.success("Document renamed");
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(msg(e)),
  });
  return (
    <TextDialog
      open={!!doc}
      onOpenChange={(o) => !o && onClose()}
      title="Rename document"
      label="Title"
      initial={doc?.title ?? ""}
      maxLength={500}
      pending={m.isPending}
      onSubmit={(v) => m.mutate(v)}
    />
  );
}

export function DeleteDocumentDialog({ doc, onClose, onDeleted }: { doc: DocumentOut | null; onClose: () => void; onDeleted?: () => void }) {
  const invalidate = useInvalidate();
  const m = useMutation({
    mutationFn: () => api(`/documents/${doc!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Document deleted");
      invalidate();
      onClose();
      onDeleted?.();
    },
    onError: (e) => toast.error(msg(e)),
  });
  return (
    <ConfirmDialog
      open={!!doc}
      onOpenChange={(o) => !o && onClose()}
      title="Delete this document?"
      description={`"${doc?.title ?? ""}" and all of its extracted text and embeddings will be permanently removed. Past answers keep their saved citation snapshots.`}
      pending={m.isPending}
      onConfirm={() => m.mutate()}
    />
  );
}

export function AssignCollectionsDialog({ doc, onClose }: { doc: DocumentOut | null; onClose: () => void }) {
  const { data: collections, isLoading } = useCollections();
  const [selected, setSelected] = useState<string[]>([]);
  const invalidate = useInvalidate();
  useEffect(() => {
    if (doc) setSelected(doc.collection_ids);
  }, [doc]);
  const m = useMutation({
    mutationFn: () => api(`/documents/${doc!.id}`, { method: "PATCH", body: { collection_ids: selected } }),
    onSuccess: () => {
      toast.success("Collections updated");
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(msg(e)),
  });
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to collections</DialogTitle>
          <DialogDescription>{doc?.title}</DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {collections?.length === 0 && <p className="text-sm text-muted-foreground">No collections yet. Create one on the Collections page.</p>}
          {collections?.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <Checkbox
                id={`col-${c.id}`}
                checked={selected.includes(c.id)}
                onCheckedChange={(v) => setSelected((s) => (v ? [...s, c.id] : s.filter((x) => x !== c.id)))}
              />
              <Label htmlFor={`col-${c.id}`} className="font-normal">
                {c.name} <span className="text-muted-foreground">({c.document_count})</span>
              </Label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()} data-testid="assign-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useReprocess() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api(`/documents/${id}/reprocess`, { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Reprocessing started");
      invalidate();
    },
    onError: (e) => toast.error(msg(e)),
  });
}
