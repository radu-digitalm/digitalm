// Admin navigation — one list shared by the shell and any page that links across.
// Log out is an action (POST /api/admin/logout) rendered by Nav, not a route.
// Opt-outs belongs to the outreach module and is listed only once it ships.
import { OUTREACH_MODULE } from "./features";

export type NavItem = { href: string; label: string };

export const ADMIN_NAV: readonly NavItem[] = [
  { href: "/admin", label: "Today" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/find", label: "Find" },
  { href: "/admin/prospects", label: "Prospects" },
  ...(OUTREACH_MODULE ? [{ href: "/admin/optouts", label: "Opt-outs" }] : []),
];

/** "/admin" matches only itself; other items match their subtree. */
export function isActiveNav(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
