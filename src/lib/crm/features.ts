// Module gates. No imports, so pure modules and node --test can read them.
//
// OUTREACH_MODULE: the outreach module (contract §1.1 — /admin/optouts,
// /api/admin/optouts, /api/admin/prospects/[id]/{send,call,manual-send},
// /o/[token], the legal blocks, the opposition list) is not on this branch.
// While it is false every control that would call those routes, or hand a
// /r/{token} link to a prospect, stays hidden: this build is audit-and-report
// only and NO PROSPECT MAY BE CONTACTED FROM IT. The outreach PR flips it.
export const OUTREACH_MODULE = false;
