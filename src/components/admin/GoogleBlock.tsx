"use client";

// The prospect page's Google listing section (docs/finder-google-spec.md
// §5.6). Hidden while Google is off; placed after the audit block as a
// collapsed <details>. The summary and the badge carry status words — our
// audit result, no attribution. Inside, and only inside — while the mini map
// is hidden through `html[data-google-open]` (rule §3.4) — the derived signals
// as words with the Google Maps logo, "Data: …" when Google named a provider,
// View on Google Maps, Google's own full listing panel, and the §4.5 actions:
// Check again, Match manually (the candidates render here and nowhere else),
// Not this listing, Clear. Every failure is a sentence in a toast.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminFetchError } from "./adminFetch";
import { Badge, type BadgeVariant } from "./Badge";
import { Button } from "./Button";
import { googleAction, type GoogleAction, type GoogleCandidate, type GoogleListingReason, type GoogleUsage, type ProspectWithGoogle } from "./finderApi";
import { localDateTime } from "./format";
import { GoogleAttribution } from "./GoogleAttribution";
import { GoogleListingPanel } from "./GoogleListingPanel";
import { googleMapsPlaceUrl } from "./googleMaps";
import { GOOGLE_SIGNALS_MAX_AGE_DAYS, googleCandidateLine, googleDataLine, googleReasonWord, googleSignalAgeDays, googleSignalWords, googleStatusOfProspect, googleStatusTone, googleStatusWord, type GoogleTone } from "./googleWords";
import { useToast } from "./Toast";
import { GOOGLE_TEXT, fill } from "./wording";

const TONE: Record<GoogleTone, BadgeVariant> = { good: "good", warn: "warn", bad: "bad", neutral: "neutral" };

function toastFor(e: unknown): string {
  const code = e instanceof AdminFetchError ? e.code : "";
  if (code === "google_off") return GOOGLE_TEXT.toastOff;
  if (code === "google_monthly_cap") return GOOGLE_TEXT.toastMonthlyCap;
  if (code === "google_unavailable") return GOOGLE_TEXT.toastUnavailable;
  if (code === "google_refused") return GOOGLE_TEXT.toastRefused;
  return GOOGLE_TEXT.toastFailed;
}

export function GoogleBlock({ prospect, enabled }: { prospect: ProspectWithGoogle; enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [p, setP] = useState<ProspectWithGoogle>(prospect);
  const [reason, setReason] = useState<GoogleListingReason | null>(null);
  const [usage, setUsage] = useState<GoogleUsage | null>(null);
  const [candidates, setCandidates] = useState<GoogleCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // A server refresh (router.refresh) brings new props; local answers win until then.
  useEffect(() => {
    setP(prospect);
  }, [prospect]);

  // Rule §3.4: while the section is open the mini map hides (MiniMap reads html[data-google-open]).
  useEffect(() => {
    const root = document.documentElement;
    if (open && enabled) root.setAttribute("data-google-open", "");
    else root.removeAttribute("data-google-open");
    return () => root.removeAttribute("data-google-open");
  }, [open, enabled]);

  if (!enabled) return null;

  async function act(body: GoogleAction) {
    setBusy(body.action);
    try {
      const r = await googleAction(p.id, body);
      if (r.usage) setUsage(r.usage);
      if (body.action === "find") {
        const list = (r.candidates ?? []).slice(0, 5);
        setCandidates(list);
        if (list.length === 0) toast.push(GOOGLE_TEXT.noCandidates, "info");
        return;
      }
      setP((cur) => {
        const next: ProspectWithGoogle = { ...cur, ...(r.prospect ?? {}) };
        if (r.signals !== undefined) next.googleSignals = r.signals;
        else if (r.prospect && r.prospect.googleSignals === undefined) next.googleSignals = cur.googleSignals;
        return next;
      });
      setReason(r.reason ?? null);
      setCandidates(null);
      toast.push(body.action === "check" ? GOOGLE_TEXT.listingChecked : body.action === "clear" ? GOOGLE_TEXT.listingReset : GOOGLE_TEXT.listingRecorded, "good");
      router.refresh();
    } catch (e) {
      toast.push(toastFor(e), "bad");
    } finally {
      setBusy(null);
    }
  }

  const status = googleStatusOfProspect(p, reason);
  const tone = googleStatusTone(status);
  const signals = p.googleListing === "found" ? (p.googleSignals ?? null) : null;
  const age = googleSignalAgeDays(signals?.fetchedAt);
  const stale = age !== null && age > GOOGLE_SIGNALS_MAX_AGE_DAYS;
  const checkedAt = p.googleCheckedAt ?? p.googleConfirmedAt ?? null;
  const how = p.googleMatch === "manual" ? GOOGLE_TEXT.confirmedByYou : p.googleMatch === "auto" ? GOOGLE_TEXT.matchedAuto : null;
  const reasonWord = status === "found_no_details" ? googleReasonWord(reason) : null;
  const mapsUrl = googleMapsPlaceUrl(p.googlePlaceId);
  const dataLine = signals ? googleDataLine(signals.attributions) : "";

  return (
    <details className="card p-5" data-testid="google-block" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-[19px] text-fg-heading">{fill(GOOGLE_TEXT.summary, { status: googleStatusWord(status, true) })}</summary>
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2" data-testid="google-status">
          <Badge variant={TONE[tone]}>{googleStatusWord(status)}</Badge>
          {reasonWord ? <span className="text-[14px] text-fg-muted">{reasonWord}</span> : null}
        </div>

        {checkedAt ? (
          <p className="text-[14px] text-fg-muted">
            {how ? fill(GOOGLE_TEXT.checkedLine, { when: localDateTime(checkedAt), how }) : `Checked ${localDateTime(checkedAt)}`}
            {stale && age !== null ? ` · ${fill(GOOGLE_TEXT.recheck, { days: age })}` : ""}
          </p>
        ) : null}

        {signals ? (
          <div data-testid="google-signals" className="space-y-1">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-fg">
              {googleSignalWords(signals).map((w) => (
                <span key={w}>{w}</span>
              ))}
              <GoogleAttribution />
            </p>
            {dataLine ? <p className="text-[14px] text-fg-muted">{dataLine}</p> : null}
          </div>
        ) : null}

        {mapsUrl ? (
          <p className="text-[15px]">
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer nofollow" className="link-accent">
              {GOOGLE_TEXT.viewOnGoogleMaps}
            </a>
          </p>
        ) : null}

        {p.googlePlaceId ? (
          <details data-testid="google-panel" onToggle={(e) => setPanelOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer text-[15px] text-fg-muted">{GOOGLE_TEXT.showListing}</summary>
            {panelOpen ? <GoogleListingPanel placeId={p.googlePlaceId} variant="full" className="mt-2" /> : null}
          </details>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void act({ action: "check" })} loading={busy === "check"} disabled={busy !== null}>
            {GOOGLE_TEXT.checkAgain}
          </Button>
          <Button size="sm" onClick={() => void act({ action: "find" })} loading={busy === "find"} disabled={busy !== null}>
            {GOOGLE_TEXT.matchManually}
          </Button>
          <Button size="sm" onClick={() => void act({ action: "reject" })} loading={busy === "reject"} disabled={busy !== null}>
            {GOOGLE_TEXT.notThisListing}
          </Button>
          {p.googleListing !== "unverified" ? (
            <Button size="sm" onClick={() => void act({ action: "clear" })} loading={busy === "clear"} disabled={busy !== null}>
              {GOOGLE_TEXT.clear}
            </Button>
          ) : null}
        </div>
        {usage ? <p className="text-[14px] text-fg-muted">{fill(GOOGLE_TEXT.usageLine, { used: usage.checks.used, cap: usage.checks.cap })}</p> : null}

        {candidates && candidates.length > 0 ? (
          <div data-testid="google-candidates" className="space-y-2">
            <ul className="space-y-1.5 text-[15px]">
              {candidates.map((c) => {
                const data = googleDataLine(c.attributions);
                return (
                  <li key={c.placeId} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="break-words">{googleCandidateLine(c)}</span>
                      {data ? <span className="block text-[14px] text-fg-muted">{data}</span> : null}
                    </span>
                    <Button size="sm" onClick={() => void act({ action: "confirm", placeId: c.placeId })} loading={busy === "confirm"} disabled={busy !== null}>
                      {GOOGLE_TEXT.use}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <GoogleAttribution />
          </div>
        ) : candidates ? (
          <p className="text-[15px] text-fg-muted">{GOOGLE_TEXT.noCandidates}</p>
        ) : null}
      </div>
    </details>
  );
}
