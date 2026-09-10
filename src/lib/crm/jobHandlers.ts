// Registry of job handlers by kind. Each owner module appends ONE line under
// its own marker; to avoid an import at the top (and a load-time cycle with
// jobs.ts) register with a dynamic import, e.g.
//   audit: (job, ctx) => import("@/lib/audit/job").then((m) => m.runAuditJob(job, ctx)),
import type { JobHandler, JobKind } from "@/lib/crm/types";

export const handlers: Partial<Record<JobKind, JobHandler>> = {
  // Foundation: exercised by the acceptance test "insert a noop job → done within 10 s".
  noop: async (job, ctx) => {
    ctx.log("noop");
    return { ok: true, payload: job.payload };
  },
  // @@jobs:audit

  // @@jobs:outreach

  // @@jobs:inbox
};
