"use client";

// Foundation stub — replaced whole by the audit module (contract §1.1).
// The real panel takes the same { prospectId } prop and self-loads its state
// from GET /api/admin/prospects/[id]/audit, so finder's prospect page can
// compose it without importing another module's lib.
export function AuditBlock(_props: { prospectId: number }) {
  return null;
}
