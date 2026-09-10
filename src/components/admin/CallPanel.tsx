"use client";

// Foundation stub — replaced whole by the outreach module (contract §1.1).
// The real panel takes the same { prospectId } prop and self-loads its state
// from GET /api/admin/prospects/[id]/call, so finder's prospect page can
// compose it without importing another module's lib.
export function CallPanel(_props: { prospectId: number }) {
  return null;
}
