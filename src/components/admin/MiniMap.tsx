"use client";

// Client wrapper for the prospect page's single-pin map (docs/finder-ux-spec.md
// §5.3 "MiniMap"): does the ssr:false import of FindMap so the server page
// stays a server component. Nothing renders without coordinates.
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ResultRow } from "./finderApi";

const FindMap = dynamic(() => import("./FindMap"), { ssr: false, loading: () => <div className="h-[220px] rounded-xl border border-line bg-surface-2" aria-hidden="true" /> });

export function MiniMap({ lat, lng, name, className = "" }: { lat: number | null; lng: number | null; name: string; className?: string }) {
  const rows = useMemo<ResultRow[]>(() => {
    if (lat === null || lng === null) return [];
    return [
      {
        key: "prospect",
        source: "manual",
        sourceId: "prospect",
        sourceUrl: "",
        sources: [],
        provenance: {},
        name,
        countryCode: "",
        countryName: "",
        countrySource: "source",
        lat,
        lng,
        geoSource: "source",
        inside: "yes",
        distanceKm: null,
      } as unknown as ResultRow,
    ];
  }, [lat, lng, name]);
  if (lat === null || lng === null) return null;
  return <FindMap mini area={null} rows={rows} className={`h-[220px] ${className}`} />;
}
