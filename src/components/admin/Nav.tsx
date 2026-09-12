"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ADMIN_NAV, isActiveNav } from "@/lib/crm/nav";
import { adminFetch } from "./adminFetch";

// One burger button on the right of the header opens a drawer with
// Today · Leads · Find · Prospects · Opt-outs · Log out — on every screen size,
// so the pages keep their full width. The header shows where you are. Log out
// is a CSRF-guarded POST followed by a full navigation so the cleared cookie
// takes effect. Esc, the overlay and any navigation close the drawer. The drawer
// is portalled to <body>: the sticky header has backdrop-filter, which would
// otherwise turn position:fixed into "fixed inside the header".
export function Nav({ subject }: { subject: string | null }) {
  const pathname = usePathname() ?? "";
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const firstLink = useRef<HTMLAnchorElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    firstLink.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function logout() {
    setBusy(true);
    try {
      await adminFetch("/api/admin/logout", {});
    } catch {
      /* cookie may already be gone — the login page is the right place either way */
    }
    window.location.assign("/admin/login");
  }

  const current = ADMIN_NAV.find((item) => isActiveNav(pathname, item.href));

  return (
    <nav aria-label="Admin" className="flex flex-1 items-center justify-end gap-3">
      {current ? <span className="mr-auto truncate text-[17px] text-fg-muted">{current.label}</span> : <span className="mr-auto" />}
      {subject ? <span className="hidden text-[15px] text-fg-muted md:inline">{subject}</span> : null}
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[16px] text-fg-heading hover:bg-surface-2"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="text-[20px] leading-none">☰</span>
        <span className="hidden sm:inline">Menu</span>
      </button>
      {open && mounted ? createPortal(
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)} />
          <div
            id={menuId}
            role="dialog"
            aria-label="Admin menu"
            className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 border-l border-line bg-ink p-4 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-[17px] text-fg-heading">Digital M · CRM</span>
              <button type="button" className="rounded-md px-2 py-1 text-[20px] leading-none text-fg-muted hover:text-fg-heading" aria-label="Close menu" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            {ADMIN_NAV.map((item, i) => {
              const active = isActiveNav(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  ref={i === 0 ? firstLink : undefined}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-2.5 text-[18px] transition-colors ${active ? "bg-surface-3 text-fg-heading" : "text-fg-muted hover:bg-surface-2 hover:text-fg-heading"}`}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="mt-auto border-t border-line pt-3">
              {subject ? <div className="px-3 pb-2 text-[14px] text-fg-muted">{subject}</div> : null}
              <button type="button" onClick={logout} disabled={busy} className="w-full rounded-md px-3 py-2.5 text-left text-[18px] text-fg-muted hover:bg-surface-2 hover:text-fg-heading disabled:opacity-60">
                Log out
              </button>
            </div>
          </div>
        </>,
        document.body,
      ) : null}
    </nav>
  );
}
