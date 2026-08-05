/**
 * lead-ingestion scheduler — periodic, overlap-guarded cross-tenant sweep.
 *
 * Cross-tenant discovery is via the SECURITY DEFINER function
 * `list_sftp_lead_source_tenants()` (REVOKE FROM PUBLIC, GRANT to admin_svc in
 * migration 0029) so the NOBYPASSRLS worker role can enumerate tenants; the
 * per-tenant work then runs under runWithTenant (inside runIngestion) so each
 * tenant only ever touches its own rows. Overlap-guarded exactly like the CRM
 * document-alert scheduler.
 */
import { pino } from "pino";
import { sqlClient } from "../../shared/db.js";
import { runIngestion, type RunOutcome } from "./service.js";

const log = pino({ name: "admin:sftp-ingest-scheduler" });

/** The per-tenant runner. Injectable so the cycle can be unit-tested without a live SFTP endpoint. */
export type IngestRunner = (tenantId: string, env: string) => Promise<RunOutcome>;

/** One full cycle across every tenant with an enabled sftp lead-source connector. */
export async function runIngestionCycle(runner: IngestRunner = runIngestion): Promise<number> {
  const rows = (await sqlClient`SELECT tenant_id, env FROM list_sftp_lead_source_tenants()`) as unknown as Array<{ tenant_id: string; env: string }>;
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
