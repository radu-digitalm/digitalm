import { cookies } from "next/headers";
import { ADMIN_COOKIE, csrfTokenFor, readSession } from "@/lib/crm/auth";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Shell only — NOT the gate. The App Router skips shared layouts on soft
// navigation, so every (gated) page starts with `await requireAdmin("/admin/…")`
// and the edge middleware covers RSC requests without a cookie. This layout
// renders the chrome and the CSRF token that adminFetch() reads from
// <meta name="dm-csrf"> (React hoists the tag into <head>).
export default async function GatedLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const session = readSession(jar.get(ADMIN_COOKIE)?.value);
  return (
    <>
      {session ? <meta name="dm-csrf" content={csrfTokenFor(session)} /> : null}
      <AdminShell subject={session?.subject ?? null}>{children}</AdminShell>
    </>
  );
}
