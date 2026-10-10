"use client";

import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { useReadyDocuments } from "./hooks";

/** Multi-select over the user's ready documents (first 100, filterable). */
export function DocMultiSelect({
  value,
  onChange,
  max = 200,
  placeholder = "Select documents",
  testId = "doc-multiselect",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  placeholder?: string;
  testId?: string;
}) {
  const { data, isLoading } = useReadyDocuments();
  const [filter, setFilter] = useState("");
  const docs = (data?.items ?? []).filter((d) => d.title.toLowerCase().includes(filter.toLowerCase()));
  const label = value.length === 0 ? placeholder : `${value.length} document${value.length > 1 ? "s" : ""} selected`;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="justify-between" data-testid={testId} />}>
        <span className="truncate">{label}</span>
        <ChevronsUpDown className="opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 p-2">
        <Input aria-label="Filter documents" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-64 space-y-1 overflow-y-auto" role="group" aria-label="Documents">
          {isLoading && <p className="p-2 text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && docs.length === 0 && <p className="p-2 text-sm text-muted-foreground">No processed documents found.</p>}
          {docs.map((d) => {
            const checked = value.includes(d.id);
            return (
              <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={checked}
                  disabled={!checked && value.length >= max}
                  onCheckedChange={(v) => onChange(v ? [...value, d.id] : value.filter((x) => x !== d.id))}
                  aria-label={d.title}
                />
                <span className="truncate">{d.title}</span>
              </label>
            );
          })}
        </div>
        {value.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear selection
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
