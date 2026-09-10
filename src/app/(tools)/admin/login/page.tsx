import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, readSession, safeAdminNext } from "@/lib/crm/auth";
import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Sign in" };

// Outside (gated) on purpose: the only /admin path the middleware lets through
// without a cookie. A valid session skips straight to `next`.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeAdminNext(sp.next);
  const jar = await cookies();
  if (readSession(jar.get(ADMIN_COOKIE)?.value)) redirect(next);

  return (
    <main lang="en" className="flex min-h-screen items-center justify-center bg-ink px-6 py-16">
      <div className="card w-full max-w-sm p-8">
        <p className="eyebrow">Digital M · CRM</p>
        <h1 className="mt-2 text-2xl">Sign in</h1>
        <p className="mt-2 text-sm text-fg-muted">Shared admin password. Five attempts per ten minutes.</p>
        <div className="mt-6">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
