"use client";

// The Area field of the search bar (docs/finder-ux-spec.md §5.2): one text
// input; when the place is ambiguous the candidates render as a radio list
// under it (kind and country in words) and picking one re-posts with `pick`.
import type { Candidate } from "./finderApi";
import { Field } from "./Field";
import { AREA_KIND_WORDS, FIND_TEXT, fill } from "./wording";

export function AreaInput({
  value,
  onChange,
  candidates,
  onPick,
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  candidates: Candidate[] | null;
  onPick: (c: Candidate) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <Field label={FIND_TEXT.areaLabel} name="area" value={value} onChange={(e) => onChange(e.target.value)} placeholder={FIND_TEXT.areaPlaceholder} hint={candidates ? undefined : FIND_TEXT.areaHint} autoComplete="off" maxLength={120} disabled={disabled} required />
      {candidates && candidates.length > 0 ? (
        <fieldset data-testid="area-candidates" className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <legend className="px-1 text-[15px] text-amber-200">{FIND_TEXT.candidatesTitle}</legend>
          <div className="flex flex-col gap-1.5">
            {candidates.map((c) => (
              <label key={`${c.osmType}${c.osmId}`} className="flex cursor-pointer items-center gap-2 text-[15px] text-fg-heading">
                <input type="radio" name="area-candidate" onChange={() => onPick(c)} className="h-[18px] w-[18px]" />
                <span>{fill(FIND_TEXT.candidate, { label: c.label, kind: AREA_KIND_WORDS[c.kind] ?? c.kind, country: c.countryName || c.countryCode })}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
