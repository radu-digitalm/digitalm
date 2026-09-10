"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ADMIN_NAV, isActiveNav } from "@/lib/crm/nav";
import { adminFetch } from "./adminFetch";

// Today · Leads · Find · Prospects · Opt-outs · Log out. Log out is a CSRF-guarded
// POST followed by a full navigation so the cleared cookie takes effect.
export function Nav({ subject }: { subject: string | null }) {
  const pathname = usePathname() ?? "";
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await adminFetch("/api/admin/logout", {});
    } catch {
      /* cookie may already be gone — the login page is the right place either way */
    }
    window.location.assign("/admin/login");
  }

  return (
    <nav aria-label="Admin" className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
      {ADMIN_NAV.map((item) => {
        const active = isActiveNav(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 whitespace-nowrap transition-colors ${
              active ? "bg-surface-3 text-fg-heading" : "text-fg-muted hover:bg-surface-2 hover:text-fg-heading"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      <span className="flex-1" />
      {subject ? <span className="hidden text-xs text-fg-faint sm:inline">{subject}</span> : null}
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="rounded-md px-3 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg-heading disabled:opacity-60"
      >
        Log out
      </button>
    </nav>
  );
}
