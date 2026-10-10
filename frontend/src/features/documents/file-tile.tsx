import { fileTypeMeta } from "@/lib/file-types";
import { cn } from "@/lib/utils";

/** File-type tile (icon + colour + extension label). A deliberately honest stand-in: the API has no thumbnails. */
export function FileTile({ ext, size = "md", className }: { ext: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const meta = fileTypeMeta(ext);
  const Icon = meta.icon;
  const dims = size === "lg" ? "size-14 rounded-xl" : size === "sm" ? "size-8 rounded-lg" : "size-10 rounded-lg";
  return (
    <div className={cn("relative flex shrink-0 items-center justify-center", dims, meta.tile, className)} data-testid="file-tile" data-ext={meta.label} aria-label={`${meta.label} file`} role="img">
      <Icon className={size === "lg" ? "size-7" : size === "sm" ? "size-4" : "size-5"} aria-hidden />
      {size !== "sm" && <span className="absolute -right-1 -bottom-1 rounded bg-background px-1 text-[0.55rem] leading-4 font-bold tracking-wide ring-1 ring-border">{meta.label}</span>}
    </div>
  );
}
