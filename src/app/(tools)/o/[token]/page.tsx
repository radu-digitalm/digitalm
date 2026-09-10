import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OPTOUT_PAGE } from "@/content/outreach";
import { privacyUrl } from "@/lib/outreach/legal";
import { optoutPageData } from "@/lib/outreach/optout";
import { SITE_URL } from "@/lib/seo";

// The opt-out page (contract §9): one button, no sign-in, in the language of
// the send's prospect. Unknown token → the segment's not-found.tsx with the
// invalid-link text (404). The form posts to /api/o/[token], which answers
// with a 303 back here (?done=1 / ?done=already). Rate limit and noindex
// headers come from the middleware and next.config (foundation).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const data = optoutPageData(token);
  return { title: data ? OPTOUT_PAGE[data.locale].title : "Digital M", robots: { index: false, follow: false } };
}

export default async function OptoutRoute({ params, searchParams }: Props) {
  const { token } = await params;
  const data = optoutPageData(token);
  if (!data) notFound();
  const sp = await searchParams;
  const doneRaw = sp.done;
  const done = (Array.isArray(doneRaw) ? doneRaw[0] : doneRaw) ?? "";
  const t = OPTOUT_PAGE[data.locale];
  const state: "form" | "done" | "already" = done === "1" ? "done" : data.already || done === "already" ? "already" : "form";
  const privacy = privacyUrl(SITE_URL, data.locale);

  return (
    <main lang={data.locale} className="flex min-h-screen items-center justify-center bg-ink px-6 py-20 text-fg">
      <div className="w-full max-w-lg">
        <p className="eyebrow">Digital M</p>
        <h1 className="mt-4 text-3xl md:text-4xl">{t.title}</h1>

        {state === "done" ? (
          <p role="status" className="mt-6 text-fg-muted">
            {t.done}
          </p>
        ) : null}
        {state === "already" ? (
          <p role="status" className="mt-6 text-fg-muted">
            {t.already}
          </p>
        ) : null}
        {state === "form" ? (
          <>
            <p className="mt-6 text-fg-muted">{t.text}</p>
            <form method="post" action={`/api/o/${encodeURIComponent(token)}`} className="mt-8">
              <input type="hidden" name="confirm" value="1" />
              <button type="submit" className="btn-primary inline-flex items-center px-5 py-3 text-sm">
                {t.button}
              </button>
            </form>
          </>
        ) : null}

        <footer className="mt-12 border-t border-line pt-4 text-xs leading-relaxed text-fg-faint">
          {t.footer} · {t.privacy}
          {data.locale === "fr" ? " : " : ": "}
          <a href={privacy} className="link-accent break-all">
            {privacy}
          </a>
        </footer>
      </div>
    </main>
  );
}
