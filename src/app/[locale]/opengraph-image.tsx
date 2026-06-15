import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Digital M — AI for commerce, grounded in real delivery";

export default async function OgImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";

  const bytes = await readFile(
    join(process.cwd(), "public/media/brand-abstract-landscape.png"),
  );
  const bg = `data:image/png;base64,${bytes.toString("base64")}`;

  const headline =
    loc === "fr" ? "L'IA dans le commerce," : "AI in commerce,";
  const accent =
    loc === "fr" ? "ancrée dans le concret." : "grounded in real delivery.";
  const sub =
    loc === "fr"
      ? "E-commerce · Salesforce · 15+ ans de delivery retail"
      : "E-commerce · Salesforce · 15+ years of retail delivery";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          position: "relative",
          backgroundColor: "#0A0E16",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bg}
          width={1200}
          height={630}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background:
              "linear-gradient(90deg, #0A0E16 0%, rgba(10,14,22,0.92) 40%, rgba(10,14,22,0.4) 78%, rgba(10,14,22,0.15) 100%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 64,
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                background: "linear-gradient(115deg, #F15A24, #ED1E79)",
              }}
            />
            <div style={{ fontSize: 30, color: "#F4F6FA", fontWeight: 600 }}>
              Digital M
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 62, color: "#F4F6FA", lineHeight: 1.05 }}>
              {headline}
            </div>
            <div style={{ fontSize: 62, color: "#ED1E79", lineHeight: 1.05 }}>
              {accent}
            </div>
            <div style={{ marginTop: 22, fontSize: 24, color: "#AEB6C4" }}>
              {sub}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
