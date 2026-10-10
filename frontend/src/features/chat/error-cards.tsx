"use client";

import { Clock, KeyRound, OctagonX, Settings2, WifiOff } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ProviderErrorKind = "not_configured" | "rate_limited" | "timeout" | "unreachable" | "bad_response" | "other";

/** Classify a chat failure from its API error code, falling back to the message text (persisted errors keep only text). */
export function classifyProviderError(code: string | null | undefined, message: string | null | undefined): ProviderErrorKind {
  const c = code ?? "";
  const m = message ?? "";
  if (c === "provider_not_configured" || /no model configured|LLM_MODEL|API_KEY|not configured/i.test(m)) return "not_configured";
  if (c === "provider_rate_limited" || /rate.?limit|too many requests|429/i.test(m)) return "rate_limited";
  if (c === "provider_timeout" || /timed out|timeout/i.test(m)) return "timeout";
  if (c === "provider_unreachable" || /could not reach|unreachable/i.test(m)) return "unreachable";
  if (c === "provider_bad_response" || /unexpected response|malformed|empty answer/i.test(m)) return "bad_response";
  return "other";
}

const COPY: Record<ProviderErrorKind, { title: string; hint: string; icon: React.ElementType }> = {
  not_configured: {
    title: "The AI model isn't configured yet",
    hint: "Choose a provider and model in Settings → AI provider (or ask the administrator to set LLM_MODEL and the provider's API key on the server), then retry.",
    icon: KeyRound,
  },
  rate_limited: {
    title: "The AI provider is rate-limiting requests",
    hint: "Wait a minute and retry. Free-tier providers allow only a limited number of requests per minute.",
    icon: Clock,
  },
  timeout: { title: "The AI provider took too long to answer", hint: "It may be busy or cold-starting. Retry in a moment.", icon: Clock },
  unreachable: { title: "Can't reach the AI provider", hint: "Check that the provider is running and reachable from the server, then retry.", icon: WifiOff },
  bad_response: { title: "The AI provider returned an unusable answer", hint: "Retrying usually helps. If it keeps happening, try a different model.", icon: OctagonX },
  other: { title: "The answer could not be generated", hint: "", icon: OctagonX },
};

export function ChatErrorCard({
  code,
  message,
  onRetry,
  retryTestId = "retry-stream",
  testId = "stream-error",
  className,
}: {
  code?: string | null;
  message: string;
  onRetry?: () => void;
  retryTestId?: string;
  testId?: string;
  className?: string;
}) {
  const kind = classifyProviderError(code, message);
  const { title, hint, icon: Icon } = COPY[kind];
  return (
    <div role="alert" data-testid={testId} data-kind={kind} className={cn("flex flex-wrap items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm", className)}>
      <Icon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-destructive" data-testid="error-title">
          {title}
        </p>
        {message && <p className="text-muted-foreground">{message}</p>}
        {hint && <p className="text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {kind === "not_configured" && (
          <Link href="/settings?tab=provider" className={buttonVariants({ variant: "default", size: "sm" })} data-testid="open-provider-settings">
            <Settings2 aria-hidden /> Open AI provider settings
          </Link>
        )}
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} data-testid={retryTestId}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
