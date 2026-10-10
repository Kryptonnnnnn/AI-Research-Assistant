"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import type { NoteIn, NoteOut } from "@/types/api";

export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function SaveNoteDialog({
  open,
  onOpenChange,
  defaultTitle = "",
  content = "",
  sourceMessageId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultTitle?: string;
  content?: string;
  sourceMessageId?: string | null;
  onSaved?: (n: NoteOut) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState(content);
  const [tags, setTags] = useState("");
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle.slice(0, 200));
      setBody(content);
      setTags("");
    }
  }, [open, defaultTitle, content]);
  const m = useMutation({
    mutationFn: (payload: NoteIn) => api<NoteOut>("/notes", { method: "POST", body: payload }),
    onSuccess: (n) => {
      toast.success("Saved to notes");
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
      onSaved?.(n);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save the note"),
  });
  const valid = title.trim().length > 0 && body.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) m.mutate({ title: title.trim(), content: body, source_message_id: sourceMessageId ?? null, tags: parseTags(tags) });
          }}
        >
          <DialogHeader>
            <DialogTitle>Save to notes</DialogTitle>
            <DialogDescription>{sourceMessageId ? "Citations from this answer are saved with the note." : "Save this text to your research notes."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="note-title">Title</Label>
            <Input id="note-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} data-testid="note-title" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note-content">Content</Label>
            <Textarea id="note-content" rows={8} value={body} maxLength={50000} onChange={(e) => setBody(e.target.value)} data-testid="note-content" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note-tags">Tags (comma separated)</Label>
            <Input id="note-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="methods, to-read" data-testid="note-tags" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || m.isPending} data-testid="note-save">
              {m.isPending ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
