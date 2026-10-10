import { BookMarked, FileText, FlaskConical, FolderOpen, LayoutDashboard, MessageSquare, Search, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/collections", label: "Collections", icon: FolderOpen },
    ],
  },
  {
    label: "Research",
    items: [
      { href: "/chat", label: "Research chats", icon: MessageSquare },
      { href: "/search", label: "Search", icon: Search },
      { href: "/research", label: "Research tools", icon: FlaskConical },
      { href: "/notes", label: "Saved notes", icon: BookMarked },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };

export const ALL_NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

/** Breadcrumb trail for the toolbar, derived from the route. */
export function breadcrumbs(pathname: string): Array<{ label: string; href?: string }> {
  const parts = pathname.split("/").filter(Boolean);
  const root = ALL_NAV.find((n) => n.href === `/${parts[0]}`);
  if (!root) return [{ label: "Research Assistant" }];
  const crumbs: Array<{ label: string; href?: string }> = [{ label: root.label, href: parts.length > 1 ? root.href : undefined }];
  if (parts.length > 1) crumbs.push({ label: parts[0] === "chat" ? "Conversation" : parts[0] === "documents" ? "Document" : "Details" });
  return crumbs;
}
