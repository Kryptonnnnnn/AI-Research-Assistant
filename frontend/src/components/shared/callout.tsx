import { AlertTriangle, Info, OctagonX } from "lucide-react";

import { cn } from "@/lib/utils";

const STYLES = {
  error: { box: "border-destructive/40 bg-destructive/5", icon: OctagonX, iconClass: "text-destructive", title: "text-destructive" },
  warning: { box: "border-amber-500/40 bg-amber-500/10", icon: AlertTriangle, iconClass: "text-amber-700 dark:text-amber-400", title: "" },
  info: { box: "border-primary/30 bg-primary/5", icon: Info, iconClass: "text-primary", title: "" },
} as const;

/** Inline status message with an icon. Uses role=alert for errors and role=status otherwise. */
export function Callout({
  tone,
  title,
  children,
  testId,
  className,
  action,
}: {
  tone: keyof typeof STYLES;
  title: string;
  children?: React.ReactNode;
  testId?: string;
  className?: string;
  action?: React.ReactNode;
}) {
  const s = STYLES[tone];
  const Icon = s.icon;
  return (
    <div role={tone === "error" ? "alert" : "status"} data-testid={testId} data-tone={tone} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", s.box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", s.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium", s.title)}>{title}</p>
        {children && <div className="mt-0.5 text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}
