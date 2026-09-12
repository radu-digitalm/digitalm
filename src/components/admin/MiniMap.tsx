"use client";

// Client wrapper for the prospect page's single-pin map (docs/finder-ux-spec.md
// §5.3 "MiniMap"): does the ssr:false import of FindMap so the server page
// stays a server component. Nothing renders without coordinates. Always
// Leaflet — no map load spent on one pin. While the page's Google listing
// section is open (`html[data-google-open]`, docs/finder-google-spec.md §3.4)
// the map is hidden: derived Google words never share a page with a visible map.
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
  return <FindMap mini area={null} rows={rows} className={`h-[220px] [html[data-google-open]_&]:hidden ${className}`} />;
}
