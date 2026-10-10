import { FileCode2, FileText, FileType2, type LucideIcon } from "lucide-react";

export interface FileTypeMeta {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the tile (background + foreground), AA-contrast in light and dark. */
  tile: string;
}

const PDF: FileTypeMeta = { label: "PDF", icon: FileText, tile: "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300" };
const DOCX: FileTypeMeta = { label: "DOCX", icon: FileType2, tile: "bg-blue-500/10 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300" };
const MD: FileTypeMeta = { label: "MD", icon: FileCode2, tile: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300" };
const TXT: FileTypeMeta = { label: "TXT", icon: FileText, tile: "bg-slate-500/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300" };

/** Icon + colour for a document by extension (".pdf" or "pdf"). No server thumbnails exist, so none are faked. */
export function fileTypeMeta(ext: string): FileTypeMeta {
  switch (ext.replace(/^\./, "").toLowerCase()) {
    case "pdf":
      return PDF;
    case "docx":
      return DOCX;
    case "md":
    case "markdown":
      return MD;
    default:
      return TXT;
  }
}
