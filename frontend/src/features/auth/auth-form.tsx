"use client";

import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, postJson } from "@/lib/api";
import { validatePassword } from "@/lib/validation";
import type { AuthOut } from "@/types/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isRegister = mode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isRegister) {
      const pwErr = validatePassword(password);
      if (pwErr) return setError(pwErr);
    }
    setPending(true);
    try {
      await postJson<AuthOut>(isRegister ? "/auth/register" : "/auth/login", {
        email,
        password,
        ...(isRegister ? { display_name: name } : {}),
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-5" aria-hidden />
        </div>
        <span className="text-lg font-semibold tracking-tight">AI Research Assistant</span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{isRegister ? "Create your account" : "Welcome back"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isRegister ? "Upload papers and ask questions with cited answers." : "Sign in to your research workspace."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {isRegister && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={isRegister ? "pw-hint" : undefined}
          />
          {isRegister && (
            <p id="pw-hint" className="text-xs text-muted-foreground">
              At least 10 characters, with upper- and lower-case letters and a number.
            </p>
          )}
        </div>
        {error && (
          <p role="alert" data-testid="auth-error" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending} data-testid="auth-submit">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {isRegister ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        {isRegister ? "Already have an account?" : "New here?"}{" "}
        <Link href={isRegister ? "/login" : "/register"} className="font-medium text-primary underline-offset-4 hover:underline">
          {isRegister ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
