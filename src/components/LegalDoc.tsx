import type { Section } from "@/content/types";

type Doc = {
  title: string;
  updated: string;
  placeholderNote: string;
  sections: Section[];
};

export function LegalDoc({ doc }: { doc: Doc }) {
  return (
    <section className="container-x py-16 md:py-20">
      <div className="max-w-prose">
        <h1 className="display-tight text-display-l">{doc.title}</h1>
        <p className="mt-3 font-mono text-xs text-fg-faint">{doc.updated}</p>

        {doc.placeholderNote && (
          <div className="card mt-8 border border-accent/30 p-5 text-sm leading-relaxed text-fg-muted">
            {doc.placeholderNote}
          </div>
        )}

        <div className="mt-10 space-y-8">
          {doc.sections.map((s) => (
            <div key={s.heading}>
              <h2 className="text-xl">{s.heading}</h2>
              <p className="mt-3 leading-relaxed text-fg-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
