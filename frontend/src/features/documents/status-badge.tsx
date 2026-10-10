import { CheckCircle2, CircleAlert, Clock, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { stageLabel } from "@/lib/format";
import type { DocumentOut } from "@/types/api";

export function StatusBadge({ doc }: { doc: Pick<DocumentOut, "status" | "progress" | "stage"> }) {
  if (doc.status === "ready")
    return (
      <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400" data-testid="doc-status">
        <CheckCircle2 className="size-3" aria-hidden /> Ready
      </Badge>
    );
  if (doc.status === "failed")
    return (
      <Badge variant="destructive" className="gap-1" data-testid="doc-status">
        <CircleAlert className="size-3" aria-hidden /> Failed
      </Badge>
    );
  const active = doc.status === "processing";
  return (
    <div className="flex min-w-36 flex-col gap-1" data-testid="doc-status" data-status={doc.status}>
      <Badge variant="outline" className="w-fit gap-1">
        {active ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Clock className="size-3" aria-hidden />}
        {active ? "Processing" : "Queued"}
      </Badge>
      <Progress value={doc.progress} aria-label="Processing progress" className="h-1.5" />
      <span className="text-xs text-muted-foreground">
        {stageLabel(doc.stage)} · {doc.progress}%
      </span>
    </div>
  );
}
