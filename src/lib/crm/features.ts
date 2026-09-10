// Module gates. No imports, so pure modules and node --test can read them.
//
// OUTREACH_MODULE: the outreach module (contract §1.1 — /admin/optouts,
// /api/admin/optouts, /api/admin/prospects/[id]/{send,call,manual-send},
// /o/[token], the legal blocks, the opposition list) is on this branch, so
// the controls that call those routes — Opt-outs nav, STOP card, Mark STOP,
// Log call, Sent from Gmail, the report links — are shown. Set it back to
// false to hide every way of contacting a prospect from a build.
export const OUTREACH_MODULE = true;
