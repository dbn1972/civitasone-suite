/**
 * lead-ingestion scheduler — periodic, overlap-guarded cross-tenant sweep.
 *
 * Cross-tenant discovery is via the (SECURITY INVOKER, as of migration 0030)
 * function `list_sftp_lead_source_tenants()`, called over the dedicated
 * BYPASSRLS `admin_scanner` pool (src/shared/scanner-db.ts) — see migration
 * 0030 for why: the function used to be SECURITY DEFINER owned by admin_svc
 * (NOBYPASSRLS), which meant RLS was always evaluated as admin_svc no matter
 * which role called it, so the discovery query silently returned zero
 * tenants in every real deployment. The per-tenant work then still runs
 * under runWithTenant (inside runIngestion) on the ordinary admin_svc pool,
 * so each tenant only ever touches its own rows. Overlap-guarded exactly
 * like the CRM document-alert scheduler.
 */
import { pino } from "pino";
import { scannerSqlClient } from "../../shared/scanner-db.js";
import { runIngestion, type RunOutcome } from "./service.js";

const log = pino({ name: "admin:sftp-ingest-scheduler" });

/** The per-tenant runner. Injectable so the cycle can be unit-tested without a live SFTP endpoint. */
export type IngestRunner = (tenantId: string, env: string) => Promise<RunOutcome>;

/** One full cycle across every tenant with an enabled sftp lead-source connector. */
export async function runIngestionCycle(runner: IngestRunner = runIngestion): Promise<number> {
  const rows = (await scannerSqlClient`SELECT tenant_id, env FROM list_sftp_lead_source_tenants()`) as unknown as Array<{ tenant_id: string; env: string }>;
  let swept = 0;
  for (const r of rows) {
    try {
      const outcome = await runner(r.tenant_id, r.env);
      if (outcome.status !== "skipped") swept++;
    } catch (err) {
      // runIngestion already swallows its own failures; this is belt-and-braces
      // so one tenant can never wedge the cycle.
      log.error({ err, tenantId: r.tenant_id, env: r.env }, "sftp ingestion cycle: tenant failed");
    }
  }
  return swept;
}

/** Start the periodic scheduler, overlap-guarded (a slow cycle never overlaps itself). */
export function startSftpLeadIngestionScheduler(intervalMs = Number(process.env.SFTP_INGEST_INTERVAL_MS ?? 300_000)): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runIngestionCycle()
      .then((n) => { if (n > 0) log.info({ swept: n }, "sftp lead-ingestion cycle complete"); })
      .catch((err) => log.error({ err }, "sftp lead-ingestion cycle failed"))
      .finally(() => { running = false; });
  }, intervalMs);
}
