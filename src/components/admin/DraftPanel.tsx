"use client";

// Foundation stub — replaced whole by the report module (contract §1.1).
// The real panel takes the same { prospectId } prop and self-loads its state
// from GET /api/admin/prospects/[id]/draft, so finder's prospect page can
// compose it without importing another module's lib.
export function DraftPanel(_props: { prospectId: number }) {
  return null;
}
