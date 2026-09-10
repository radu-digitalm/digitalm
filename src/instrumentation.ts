// Next instrumentation hook: runs once per server start. Starts the CRM job
// runner in the Node runtime only (never in the edge bundle, never during
// `next build`). CRM_JOB_RUNNER=off keeps it idle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { startJobRunner } = await import("@/lib/crm/jobs");
    startJobRunner();
  } catch (e) {
    console.error("instrumentation: job runner failed to start", e instanceof Error ? e.message : e);
  }
}
