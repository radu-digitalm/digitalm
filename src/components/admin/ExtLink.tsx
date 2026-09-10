import { safeHttpUrl } from "@/lib/crm/classify";

// Every admin href that comes from foreign data (a prospect's website, an OSM
// or register URL, a social link) goes through here: safeHttpUrl() must accept
// it, otherwise the value renders as plain text. External links always open in
// a new tab with rel="noopener noreferrer nofollow". No hooks — fine in server
// pages and client panels.
export function ExtLink({
  href,
  children,
  className = "link-accent",
  title,
}: {
  href: string | null | undefined;
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const safe = href ? safeHttpUrl(href) : null;
  if (!safe) {
    if (!href) return null;
    return <span className="break-all text-fg-muted">{children ?? href}</span>;
  }
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={`break-all ${className}`} title={title}>
      {children ?? safe.replace(/^https?:\/\//, "").replace(/\/$/, "")}
    </a>
  );
}
