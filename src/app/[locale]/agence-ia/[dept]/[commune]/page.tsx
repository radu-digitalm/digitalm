import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { CommunePage, communeMetadata, communeParams } from "@/components/GeoPages";

export const dynamicParams = false;

export function generateStaticParams() {
  return communeParams;
}

export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; dept: string; commune: string }>;
}): Promise<Metadata> {
  return communeMetadata(params);
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; dept: string; commune: string }>;
}) {
  const { locale, dept, commune } = await params;
  if (!isLocale(locale)) notFound();
  return <CommunePage locale={locale} dept={dept} commune={commune} />;
}
