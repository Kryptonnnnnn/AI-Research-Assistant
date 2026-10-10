"use client";

import { NativeSelect } from "@/components/shared/native-select";
import { useCollections } from "@/features/collections/hooks";
import { DocMultiSelect } from "@/features/documents/doc-multi-select";

export interface Scope {
  kind: "all" | "collection" | "documents";
  collectionId: string | null;
  documentIds: string[];
}

export const ALL_SCOPE: Scope = { kind: "all", collectionId: null, documentIds: [] };

export function scopeFrom(documentIds: string[], collectionId: string | null): Scope {
  if (documentIds.length) return { kind: "documents", collectionId: null, documentIds };
  if (collectionId) return { kind: "collection", collectionId, documentIds: [] };
  return ALL_SCOPE;
}

export function ScopePicker({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  const { data: collections } = useCollections();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="scope-picker">
      <NativeSelect
        aria-label="Search scope"
        value={scope.kind}
        data-testid="scope-kind"
        onChange={(e) => {
          const kind = e.target.value as Scope["kind"];
          onChange({ kind, collectionId: kind === "collection" ? (collections?.[0]?.id ?? null) : null, documentIds: [] });
        }}
      >
        <option value="all">All documents</option>
        <option value="collection">A collection</option>
        <option value="documents">Specific documents</option>
      </NativeSelect>
      {scope.kind === "collection" && (
        <NativeSelect aria-label="Collection" value={scope.collectionId ?? ""} data-testid="scope-collection" onChange={(e) => onChange({ ...scope, collectionId: e.target.value || null })}>
          {collections?.length ? null : <option value="">No collections yet</option>}
          {collections?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.document_count})
            </option>
          ))}
        </NativeSelect>
      )}
      {scope.kind === "documents" && <DocMultiSelect value={scope.documentIds} onChange={(ids) => onChange({ ...scope, documentIds: ids })} testId="scope-documents" />}
    </div>
  );
}
