"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  FileText,
  FlaskConical,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useMe } from "@/features/auth/hooks";
import { EvidenceProvider } from "@/features/chat/evidence";
import { useSettings, useUpdateSettings } from "@/features/settings/hooks";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/collections", label: "Collections", icon: FolderOpen },
  { href: "/chat", label: "Research chats", icon: MessageSquare },
  { href: "/search", label: "Semantic search", icon: Search },
  { href: "/research", label: "Research tools", icon: FlaskConical },
  { href: "/notes", label: "Saved notes", icon: BookMarked },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <span className="font-semibold tracking-tight">Research Assistant</span>
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const update = useUpdateSettings();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light / dark theme"
      data-testid="theme-toggle"
      onClick={() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
        setTheme(next);
        update.mutate({ theme: next });
      }}
    >
      <Sun className="hidden size-4 dark:block" aria-hidden />
      <Moon className="size-4 dark:hidden" aria-hidden />
    </Button>
  );
}

function UserMenu() {
  const { data: user } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
    } catch {
      /* session may already be gone */
    }
    qc.clear();
    toast.success("Signed out");
    window.location.assign("/login");
  }
  const initial = (user?.display_name || user?.email || "?").slice(0, 1).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            data-testid="user-menu"
            className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initial}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{user?.display_name || "Account"}</span>
          <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">{user?.email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/settings?tab=profile")}>
          <UserCircle aria-hidden /> Profile &amp; password
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/settings")}>
          <Settings aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} data-testid="logout">
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeSync() {
  const { data } = useSettings();
  const { setTheme } = useTheme();
  const synced = useRef(false);
  useEffect(() => {
    if (data && !synced.current) {
      synced.current = true;
      setTheme(data.theme);
    }
  }, [data, setTheme]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const { error } = useMe();
  useEffect(() => {
    // Server is authoritative: an invalid/expired session cookie bounces to login.
    if (error && (error as { status?: number }).status === 401) window.location.assign("/login");
  }, [error]);
  return (
    <EvidenceProvider>
      <ThemeSync />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <div className="flex h-screen overflow-hidden">
        <aside className="hidden w-64 shrink-0 flex-col gap-4 border-r bg-sidebar p-3 md:flex">
          <Brand />
          <div className="flex-1 overflow-y-auto">
            <NavLinks />
          </div>
          <UserMenu />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:justify-end">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)} data-testid="mobile-nav-button">
              <Menu aria-hidden />
            </Button>
            <div className="md:hidden">
              <Brand />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
            </div>
          </header>
          <main id="main" className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 max-w-[85vw] bg-sidebar p-3" showCloseButton>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
          <div className="flex-1 overflow-y-auto">
            <NavLinks onNavigate={() => setNavOpen(false)} />
          </div>
          <UserMenu />
        </SheetContent>
      </Sheet>
    </EvidenceProvider>
  );
}
