import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { DeptHub, deptHubMetadata, deptParams } from "@/components/GeoPages";

export const dynamicParams = false;

export function generateStaticParams() {
  return deptParams;
}

export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; dept: string }>;
}): Promise<Metadata> {
  return deptHubMetadata(params);
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; dept: string }>;
}) {
  const { locale, dept } = await params;
  if (!isLocale(locale)) notFound();
  return <DeptHub locale={locale} dept={dept} />;
}
