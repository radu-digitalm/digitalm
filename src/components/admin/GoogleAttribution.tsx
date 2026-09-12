// The Google Maps attribution mark (docs/finder-google-spec.md §3.5): the
// official logo from Google's attribution assets, 16–19 px high with 10 px of
// clear space; the outlined file wherever the mark sits over map imagery (the
// legend panel); the text form "Google Maps" only where space is genuinely
// limited (the list-header count). Never localised (`translate="no"`), no
// existence check of any kind — the files are committed with the code.
// No hooks, so server pages and client panels can both render it.
import { GOOGLE_TEXT } from "./wording";

export function GoogleAttribution({ text = false, onMap = false, className = "" }: { text?: boolean; onMap?: boolean; className?: string }) {
  if (text) {
    return (
      <span className={`dm-google-attr ${className}`} translate="no" data-testid="google-attribution">
        {GOOGLE_TEXT.attribution}
      </span>
    );
  }
  return (
    <span className={`dm-google-attr ${className}`} translate="no" data-testid="google-attribution">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={onMap ? "/brand/google-maps-logo-outlined.svg" : "/brand/google-maps-logo.svg"} alt={GOOGLE_TEXT.attribution} height={onMap ? 19 : 16} width={onMap ? 91 : 87} className={onMap ? "h-[19px] w-auto" : "h-4 w-auto"} decoding="async" />
    </span>
  );
}
