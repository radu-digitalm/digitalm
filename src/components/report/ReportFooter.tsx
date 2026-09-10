import { REPORT_UI, type ReportLocale } from "@/content/report";

// Identity line under every report and the expired view: Digital M /
// Digital Management Ltd, the French establishment address, the privacy
// policy in the prospect's language and the contact address as text.
export function ReportFooter({ locale, privacyHref }: { locale: ReportLocale; privacyHref: string }) {
  const ui = REPORT_UI[locale];
  return (
    <footer className="mt-12 border-t border-white/[0.07] pt-6 text-xs text-fg-faint">
      <p>{ui.footerCompany}</p>
      <p className="mt-1">{ui.footerAddress}</p>
      <p className="mt-1">
        <a href={privacyHref} className="underline underline-offset-2 hover:text-fg-muted">
          {ui.privacy}
        </a>
        {" · "}
        {ui.contact}
      </p>
    </footer>
  );
}
