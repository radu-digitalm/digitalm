import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { AgenceIaIndex, indexMetadata, indexParams } from "@/components/GeoPages";

export const dynamicParams = false;

export function generateStaticParams() {
  return indexParams;
}

export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return indexMetadata(params);
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AgenceIaIndex locale={locale} />;
}
