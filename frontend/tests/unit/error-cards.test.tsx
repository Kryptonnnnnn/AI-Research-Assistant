import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatErrorCard, classifyProviderError } from "@/features/chat/error-cards";

describe("classifyProviderError", () => {
  it.each([
    ["provider_not_configured", "x", "not_configured"],
    [null, "No model configured. Set LLM_MODEL (or choose one in Settings).", "not_configured"],
    [null, "GROQ_API_KEY is not configured on the server.", "not_configured"],
    ["provider_rate_limited", "x", "rate_limited"],
    [null, "Groq rate limit reached. Wait a moment and retry.", "rate_limited"],
    ["provider_timeout", "x", "timeout"],
    [null, "The Groq request timed out.", "timeout"],
    ["provider_unreachable", "x", "unreachable"],
    ["provider_bad_response", "x", "bad_response"],
    [null, "The model returned an empty answer. Please retry.", "bad_response"],
    ["provider_http_error", "Groq returned HTTP 500.", "other"],
  ])("%s / %s → %s", (code, message, kind) => {
    expect(classifyProviderError(code, message)).toBe(kind);
  });
});

describe("ChatErrorCard", () => {
  it("not configured: links to the AI provider settings and offers retry", async () => {
    const retry = vi.fn();
    render(<ChatErrorCard code="provider_not_configured" message="No model configured." onRetry={retry} />);
    expect(screen.getByTestId("error-title")).toHaveTextContent("isn't configured");
    expect(screen.getByTestId("open-provider-settings")).toHaveAttribute("href", "/settings?tab=provider");
    await userEvent.click(screen.getByTestId("retry-stream"));
    expect(retry).toHaveBeenCalled();
  });

  it("rate limited: tells the user to wait and retry, with no settings link", () => {
    render(<ChatErrorCard code="provider_rate_limited" message="Groq rate limit reached." onRetry={() => {}} />);
    expect(screen.getByTestId("stream-error")).toHaveAttribute("data-kind", "rate_limited");
    expect(screen.getByText(/wait a minute and retry/i)).toBeInTheDocument();
    expect(screen.queryByTestId("open-provider-settings")).toBeNull();
  });

  it("a persisted failed message (text only) is still recognised", () => {
    render(<ChatErrorCard code={null} message="No model configured. Set LLM_MODEL" testId="message-error-card" />);
    expect(screen.getByTestId("message-error-card")).toHaveAttribute("data-kind", "not_configured");
  });
});
