"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sparkles, Sun, Upload, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe } from "@/features/auth/hooks";
import { EvidenceProvider } from "@/features/chat/evidence";
import { useDashboard } from "@/features/dashboard/hooks";
import { useGlobalUpload } from "@/features/documents/use-global-upload";
import { useSettings, useUpdateSettings } from "@/features/settings/hooks";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { CommandPalette } from "./command-palette";
import { ALL_NAV, breadcrumbs, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "./nav";

const COLLAPSE_KEY = "ara.sidebar.collapsed";

function NavLink({ item, collapsed, onNavigate, badge }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void; badge?: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        collapsed && "justify-center px-0",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {active && <span className="absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-full bg-primary" aria-hidden />}
      <item.icon className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && badge}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function ProcessingBadge() {
  const { data } = useDashboard();
  const n = data?.documents.processing ?? 0;
  if (!n) return null;
  return (
    <span className="flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary" data-testid="nav-processing" title={`${n} document${n > 1 ? "s" : ""} being indexed`}>
      <Loader2 className="size-3 animate-spin" aria-hidden />
      {n}
    </span>
  );
}

function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          {collapsed ? <div className="mx-2 mb-1 h-px bg-border" aria-hidden /> : <p className="px-2.5 pb-1 text-[0.68rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">{g.label}</p>}
          {g.items.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} badge={item.href === "/documents" ? <ProcessingBadge /> : undefined} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link href="/dashboard" aria-label="Research Assistant home" className={cn("flex min-w-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", collapsed && "justify-center")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Sparkles className="size-4" aria-hidden />
      </span>
      {!collapsed && <span className="truncate text-[0.95rem] font-semibold tracking-tight whitespace-nowrap">Research Assistant</span>}
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

function UserMenu({ collapsed }: { collapsed?: boolean }) {
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
            aria-label={collapsed ? `Account: ${user?.email ?? ""}` : undefined}
            className={cn("flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring", collapsed && "justify-center")}
          />
        }
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initial}</span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user?.display_name || "Account"}</span>
            <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
          </span>
        )}
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

function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = breadcrumbs(pathname);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0" data-testid="breadcrumbs">
      <ol className="flex items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => (
          <li key={c.label} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <span className="text-muted-foreground/60" aria-hidden>
                /
              </span>
            )}
            {c.href ? (
              <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className="truncate font-medium" aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { error } = useMe();
  const { pick, picker, uploading } = useGlobalUpload();

  useEffect(() => {
    // Remembered choice wins; otherwise start collapsed on tablet-sized screens so content keeps its room.
    const saved = window.localStorage.getItem(COLLAPSE_KEY);
    setCollapsed(saved === null ? window.innerWidth < 1024 : saved === "1");
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });

  useEffect(() => {
    // Server is authoritative: an invalid/expired session cookie bounces to login.
    if (error && (error as { status?: number }).status === 401) window.location.assign("/login");
  }, [error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <EvidenceProvider>
      <ThemeSync />
      {picker}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <div className="flex h-screen overflow-hidden">
        <aside className={cn("hidden shrink-0 flex-col gap-3 border-r bg-sidebar p-3 transition-[width] duration-200 md:flex", collapsed ? "w-16" : "w-60")} aria-label="Sidebar" data-collapsed={collapsed}>
          <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between")}>
            <Brand collapsed={collapsed} />
            <Button variant="ghost" size="icon-sm" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed} onClick={toggleCollapsed} data-testid="sidebar-toggle">
              {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            </Button>
          </div>
          <Link href="/chat" aria-label="New conversation" className={cn(buttonVariants({ size: collapsed ? "icon" : "default" }), !collapsed && "w-full justify-start")} data-testid="sidebar-new-chat">
            <Plus aria-hidden /> {!collapsed && "New conversation"}
          </Link>
          <div className="min-h-0 flex-1 overflow-y-auto pl-3 -ml-3 pr-1">
            <NavLinks collapsed={collapsed} />
          </div>
          <div className="flex flex-col gap-1 border-t pt-3">
            <NavLink item={SETTINGS_ITEM} collapsed={collapsed} />
            <UserMenu collapsed={collapsed} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)} data-testid="mobile-nav-button">
              <Menu aria-hidden />
            </Button>
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="hidden w-60 justify-start text-muted-foreground lg:inline-flex" onClick={() => setPaletteOpen(true)} data-testid="open-palette" aria-label="Search or jump to (Command K)">
                <Search aria-hidden /> <span className="flex-1 text-left">Search or jump to…</span>
                <kbd className="rounded border bg-muted px-1.5 font-mono text-[0.65rem]">⌘K</kbd>
              </Button>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Search or jump to" onClick={() => setPaletteOpen(true)} data-testid="open-palette-mobile">
                <Search aria-hidden />
              </Button>
              <Button variant="outline" size="sm" onClick={pick} disabled={uploading} data-testid="global-upload">
                {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} <span className="hidden lg:inline">Upload</span>
              </Button>
              <Link href="/chat" className={cn(buttonVariants({ size: "sm" }), "hidden lg:inline-flex")} data-testid="toolbar-new-chat">
                <Plus aria-hidden /> New chat
              </Link>
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
          <div className="border-t pt-3">
            <NavLink item={SETTINGS_ITEM} onNavigate={() => setNavOpen(false)} />
            <UserMenu />
          </div>
        </SheetContent>
      </Sheet>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} nav={ALL_NAV} onUpload={pick} />
    </EvidenceProvider>
  );
}
