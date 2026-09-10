"use client";

// /admin/optouts: the opposition list (hashes only) and the manual add form.
// Adds post to /api/admin/optouts with the CSRF header, then router.refresh()
// so the server page stays the single source of truth.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtDateTime } from "@/lib/inbox/stages";
import type { OptoutListRow } from "@/lib/outreach/optout";
import { Badge, type BadgeVariant } from "./Badge";
import { Button, buttonClass } from "./Button";
import { Field } from "./Field";
import { Select } from "./Select";
import { DataTable, type Column } from "./DataTable";
import { AdminFetchError, adminFetch } from "./adminFetch";
import { useToast } from "./Toast";

type Mode = "email" | "phone" | "send_reference" | "lead_reference" | "prospect_reference";

const MODES: { value: Mode; label: string; placeholder: string; hint: string }[] = [
  { value: "email", label: "Email address", placeholder: "contact@example.fr", hint: "Hashed at once; the address itself is never stored." },
  { value: "phone", label: "Phone number", placeholder: "+33 5 61 00 00 00", hint: "Hashed as E.164 digits with the country below." },
  { value: "send_reference", label: "STOP reply (send reference)", placeholder: "SN-XXXXX", hint: "The address that email went to is listed." },
  { value: "lead_reference", label: "Lead reference", placeholder: "LD-XXXXX", hint: "Every email and phone the lead and its prospect are known by; the lead moves to STOP." },
  { value: "prospect_reference", label: "Prospect reference", placeholder: "PR-XXXXX", hint: "Every address and number on file for the prospect (override and website alike)." },
];

const NOTE_HINT = "Never an address or a number — the note is stored raw and never purged.";

const SOURCE_LABEL: Record<OptoutListRow["source"], string> = {
  link: "Unsubscribe page",
  one_click: "One-click",
  reply_stop: "STOP reply",
  call: "Refused on the phone",
  manual: "Manual",
};

const CHANNEL_VARIANT: Record<OptoutListRow["channel"], BadgeVariant> = { email: "info", phone: "warn", both: "bad" };

function short(hash: string | null): string {
  return hash ? `${hash.slice(0, 10)}…` : "—";
}

function errorMessage(e: unknown): string {
  if (e instanceof AdminFetchError) {
    const map: Record<string, string> = {
      email: "That is not a valid email address.",
      phone: "That number could not be normalised.",
      send_reference: "Send references look like SN-XXXXX.",
      send_not_found: "No send with that reference.",
      send_without_address: "That send has no recipient on record.",
      lead_reference: "Lead references look like LD-XXXXX.",
      lead_not_found: "No lead with that reference.",
      lead_without_contact: "That lead has neither an email nor a phone.",
      prospect_not_found: "No prospect with that reference.",
      prospect_without_contact: "That prospect has neither an email nor a phone.",
      note_contains_contact: "The note must not contain an email address or a phone number — it is stored raw and never purged.",
      csrf: "Session check failed — reload the page.",
    };
    return map[e.code] ?? `Request failed: ${e.code}`;
  }
  return "Request failed.";
}

function AddForm() {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("email");
  const [value, setValue] = useState("");
  const [country, setCountry] = useState("FR");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = MODES.find((m) => m.value === mode)!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { note: note.trim() || undefined };
      if (mode === "email") body.email = v;
      else if (mode === "phone") {
        body.phone = v;
        body.country = country.trim().toUpperCase();
      } else if (mode === "send_reference") {
        body.send_reference = v;
        body.source = "reply_stop";
      } else if (mode === "lead_reference") body.lead_reference = v;
      else body.prospect_reference = v;
      const r = await adminFetch<{ ok: true; recorded: boolean }>("/api/admin/optouts", body);
      toast.push(r.recorded ? "Added to the opposition list" : "Already on the list — nothing changed", r.recorded ? "good" : "info");
      setValue("");
      setNote("");
      router.refresh();
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4" aria-labelledby="optout-add">
      <h2 id="optout-add" className="text-xs uppercase tracking-wide text-fg-faint">
        Add by hand
      </h2>
      <div className="grid gap-3 md:grid-cols-[14rem_1fr_auto]">
        <Select label="What" name="optout_mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} options={MODES.map((m) => ({ value: m.value, label: m.label }))} />
        <Field label="Value" name="optout_value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={meta.placeholder} hint={meta.hint} maxLength={254} autoComplete="off" required />
        {mode === "phone" ? (
          <Field label="Country" name="optout_country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} className="w-20" autoComplete="off" />
        ) : (
          <div />
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Note (optional)" name="optout_note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} hint={NOTE_HINT} className="min-w-[16rem] flex-1" autoComplete="off" />
        <Button type="submit" variant="primary" loading={busy}>
          Add to the list
        </Button>
      </div>
    </form>
  );
}

export function OptoutTable({ rows, total, page, pageSize, sort }: { rows: OptoutListRow[]; total: number; page: number; pageSize: number; sort: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const columns: Column<OptoutListRow>[] = [
    { key: "when", header: "When", render: (r) => <span className="whitespace-nowrap text-fg-muted">{fmtDateTime(r.createdAt)}</span> },
    { key: "channel", header: "Channel", render: (r) => <Badge variant={CHANNEL_VARIANT[r.channel]}>{r.channel}</Badge> },
    { key: "source", header: "Source", render: (r) => <span>{SOURCE_LABEL[r.source]}</span> },
    {
      key: "hashes",
      header: "Hashes",
      render: (r) => (
        <span className="font-mono text-xs text-fg-muted">
          {r.emailHash ? <span title="email hash">@ {short(r.emailHash)}</span> : null}
          {r.emailHash && r.phoneHash ? " · " : null}
          {r.phoneHash ? <span title="phone hash">☎ {short(r.phoneHash)}</span> : null}
        </span>
      ),
    },
    {
      key: "links",
      header: "Linked to",
      render: (r) => (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {r.prospectId !== null && r.prospectReference ? (
            <Link href={`/admin/prospects/${r.prospectId}`} className="link-accent font-mono">
              {r.prospectReference}
            </Link>
          ) : null}
          {r.prospectName ? <span className="text-fg-muted">{r.prospectName}</span> : null}
          {r.leadId !== null && r.leadReference ? (
            <Link href={`/admin/leads/${r.leadId}`} className="link-accent font-mono">
              {r.leadReference}
            </Link>
          ) : null}
          {r.sendReference ? <span className="font-mono text-fg-faint">{r.sendReference}</span> : null}
          {r.prospectId === null && r.leadId === null && !r.sendReference ? <span className="text-fg-faint">—</span> : null}
        </span>
      ),
    },
    { key: "note", header: "Note", render: (r) => <span className="text-fg-muted">{r.note ?? ""}</span> },
  ];

  return (
    <div className="space-y-4">
      <AddForm />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
        <span>
          {total} {total === 1 ? "entry" : "entries"}
        </span>
        <span className="flex items-center gap-2">
          <Link href={`/admin/optouts?sort=${sort === "oldest" ? "created" : "oldest"}`} className="link-accent text-xs">
            {sort === "oldest" ? "Newest first" : "Oldest first"}
          </Link>
          {pages > 1 ? (
            <>
              <Link href={`/admin/optouts?sort=${sort}&page=${Math.max(1, page - 1)}`} className={buttonClass("ghost", "sm")} aria-disabled={page <= 1}>
                Previous
              </Link>
              <span className="text-xs">
                {page} / {pages}
              </span>
              <Link href={`/admin/optouts?sort=${sort}&page=${Math.min(pages, page + 1)}`} className={buttonClass("ghost", "sm")} aria-disabled={page >= pages}>
                Next
              </Link>
            </>
          ) : null}
        </span>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="Nobody has opted out yet." caption="Opposition list" dense />
    </div>
  );
}
