import type { Metadata, Viewport } from "next";
import "../globals.css";
import { fontVariables } from "@/lib/fonts";

// Second root layout for the CRM tool routes (/admin, /r, /o): same fonts and
// palette as the site, none of its public chrome — no header/footer, no
// analytics script, no cookie banner, no chat widget, no CarryParams. Every
// page here is noindex; pages set `lang` on their own top element (reports and
// opt-out pages render in the prospect's language). Root type 17 px so every
// rem-based size (text-sm…) is a notch bigger than on the public site.
export const metadata: Metadata = {
  title: { default: "Digital M", template: "%s · Digital M" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0E16",
};

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontVariables} text-[106.25%]`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
