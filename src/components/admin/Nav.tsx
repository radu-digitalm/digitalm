"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ADMIN_NAV, isActiveNav } from "@/lib/crm/nav";
import { adminFetch } from "./adminFetch";

// Today · Leads · Find · Prospects · Opt-outs · Log out. Log out is a CSRF-guarded
// POST followed by a full navigation so the cleared cookie takes effect.
// From 640 px the entries wrap; under that a Menu button opens a vertical list
// (never a sideways scroll — docs/finder-ux-spec.md §6.1).
export function Nav({ subject }: { subject: string | null }) {
  const pathname = usePathname() ?? "";
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function logout() {
    setBusy(true);
    try {
      await adminFetch("/api/admin/logout", {});
    } catch {
      /* cookie may already be gone — the login page is the right place either way */
    }
    window.location.assign("/admin/login");
  }

  const entries = ADMIN_NAV.map((item) => {
    const active = isActiveNav(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`rounded-md px-3 py-1.5 text-[15px] transition-colors ${active ? "bg-surface-3 text-fg-heading" : "text-fg-muted hover:bg-surface-2 hover:text-fg-heading"}`}
      >
        {item.label}
      </Link>
    );
  });

  const logoutButton = (
    <button type="button" onClick={logout} disabled={busy} className="rounded-md px-3 py-1.5 text-left text-[15px] text-fg-muted hover:bg-surface-2 hover:text-fg-heading disabled:opacity-60">
      Log out
    </button>
  );

  return (
    <nav aria-label="Admin" className="relative flex flex-1 items-center justify-end gap-1 sm:justify-start">
      <div className="hidden flex-1 flex-wrap items-center gap-1 sm:flex">
        {entries}
        <span className="flex-1" />
        {subject ? <span className="hidden text-[14px] text-fg-muted lg:inline">{subject}</span> : null}
        {logoutButton}
      </div>
      <button
        type="button"
        className="rounded-md border border-line px-3 py-1.5 text-[15px] text-fg-heading sm:hidden"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        Menu
      </button>
      <div id={menuId} hidden={!open} className="absolute right-0 top-full z-50 mt-2 flex w-56 flex-col gap-1 rounded-lg border border-line bg-surface p-2 shadow-xl sm:hidden">
        {entries}
        <div className="my-1 border-t border-line" />
        {logoutButton}
      </div>
    </nav>
  );
}
