/**
 * P0-2: SLA-breach sweep scheduler (the "dead engine" fix).
 *
 * applicationSlaCheck / grievanceSlaCheck consumers existed but were never
 * published, and helpdesk / RTI had no sweep at all. This periodic tick scans
 * every tenant's open grievances / applications / tickets / RTIs whose deadline
 * has passed and publishes the matching *SlaCheck command. The existing
 * consumers (and the two new ticket/rti ones) do the check-and-emit inside a
 * transaction guarded by markProcessed, so:
 *   - tenant-aware: scoped per tenant; one bad tenant is caught and skipped.
 *   - idempotent: messageId is DETERMINISTIC per overdue entity, so the same
 *     overdue item only ever fires ONE breach/escalation across repeated ticks.
 */
import { createHash } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { sqlClient } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { GRIEVANCE_ESCALATION_SLA_DAYS } from "../grievance/domain.js";

const SWEEP_ENABLED = (process.env.SLA_SWEEP_ENABLED ?? "true") !== "false";
const SWEEP_INTERVAL_MS = Number(process.env.SLA_SWEEP_INTERVAL_MS ?? 5 * 60 * 1000);
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

/**
 * Deterministic per-entity messageId so a breach fires once across ticks.
 * The queue envelope requires a valid UUID, so derive a stable RFC-4122 v5-style
 * UUID by SHA-1 hashing "sla:<kind>:<id>" and formatting the digest. Same input
 * always yields the same UUID, so markProcessed dedupes the breach across ticks.
 */
function slaMessageId(kind: string, id: string): string {
  const h = createHash("sha1").update(`sla:${kind}:${id}`).digest("hex");
  // Format as UUID and stamp version (5) + RFC variant bits.
  const v = h.slice(0, 32).split("");
  v[12] = "5";
  v[16] = ((parseInt(v[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = v.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

async function publishSlaCheck(
  queue: Queue,
  topic: string,
  tenantId: string,
  messageId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await queue.publish(topic, {
    messageId,
    type: topic,
    tenantId,
    actorId: SYSTEM_ACTOR,
    correlationId: messageId,
    schemaVersion: "1.0",
    payload,
  });
}

// NOTE (RLS bare cross-tenant scan — was silently a no-op): the four sweep*
// queries below intentionally scan ACROSS ALL TENANTS (no tenant_id filter)
// — this is a background sweeper, not a per-tenant request handler,  so
// wrapping in db.transaction()/runWithTenant() isn't an option (that only
// ever injects app.tenant_id for a SINGLE tenant).
//
// This used to go through Drizzle's `db` (bound to citizen_svc, the
// service's ordinary NOBYPASSRLS role) via a bare `db.select()` with no
// app.tenant_id GUC set at all. citizen_applications / citizen_grievances /
// citizen_tickets / citizen_rti_requests are all FORCE ROW LEVEL SECURITY,
// so `tenant_id = <schema>.current_tenant_id()` evaluated against a NULL
// current_tenant_id() and matched NOTHING — every scan silently returned
// zero rows, forever, no matter how many entities were actually overdue.
// Verified empirically against a fresh cluster: a seeded, genuinely-overdue
// application was invisible to the old query.
//
// FIX (migration 0028_sla_sweep_scanner_bypassrls.sql): each scan now calls
// a narrow, read-only SECURITY DEFINER SQL function owned by the dedicated
// citizen_scanner BYPASSRLS role — one function per table, returning only
// the id/tenant_id(+service_id) columns the sweep needs, callable by
// citizen_svc via GRANT EXECUTE. Same fix shape as workflow_scanner /
// admin's SFTP-ingestion scanner (fixed the same night). Queried via
// sqlClient (not db/Drizzle) since these are plain function calls, not
// table-shaped queries.
async function sweepApplications(queue: Queue, _now: Date): Promise<number> {
  const rows = await sqlClient<{ id: string; tenant_id: string; service_id: string }[]>`
    select id, tenant_id, service_id from application.sweep_overdue_applications()
  `;
  let n = 0;
  for (const r of rows) {
    // maxDays=0 so the consumer's isSlaBreached compares against createdAt+0 and
    // the deadline already passed; consumer re-validates before emitting.
    await publishSlaCheck(queue, COMMANDS.applicationSlaCheck, r.tenant_id, slaMessageId("app", r.id), {
      tenantId: r.tenant_id, applicationId: r.id, serviceType: r.service_id, maxDays: 0,
    });
    n++;
  }
  return n;
}

async function sweepGrievances(queue: Queue, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - GRIEVANCE_ESCALATION_SLA_DAYS * 24 * 60 * 60 * 1000);
  const rows = await sqlClient<{ id: string; tenant_id: string }[]>`
    select id, tenant_id from grievance.sweep_overdue_grievances(${cutoff.toISOString()}::timestamptz)
  `;
  let n = 0;
  for (const r of rows) {
    await publishSlaCheck(queue, COMMANDS.grievanceSlaCheck, r.tenant_id, slaMessageId("griev", r.id), {
      tenantId: r.tenant_id, grievanceId: r.id, slaDays: GRIEVANCE_ESCALATION_SLA_DAYS,
    });
    n++;
  }
  return n;
}

async function sweepTickets(queue: Queue, now: Date): Promise<number> {
  const rows = await sqlClient<{ id: string; tenant_id: string }[]>`
    select id, tenant_id from helpdesk.sweep_overdue_tickets(${now.toISOString()}::timestamptz)
  `;
  let n = 0;
  for (const r of rows) {
    await publishSlaCheck(queue, COMMANDS.ticketSlaCheck, r.tenant_id, slaMessageId("ticket", r.id), {
      tenantId: r.tenant_id, ticketId: r.id,
    });
    n++;
  }
  return n;
}

async function sweepRti(queue: Queue, _now: Date): Promise<number> {
  const rows = await sqlClient<{ id: string; tenant_id: string }[]>`
    select id, tenant_id from rti.sweep_overdue_rti()
  `;
  let n = 0;
  for (const r of rows) {
    await publishSlaCheck(queue, COMMANDS.rtiSlaCheck, r.tenant_id, slaMessageId("rti", r.id), {
      tenantId: r.tenant_id, rtiId: r.id,
    });
    n++;
  }
  return n;
}

export async function runSlaSweep(queue: Queue, log?: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }): Promise<void> {
  const now = new Date();
  const tasks: Array<[string, () => Promise<number>]> = [
    ["applications", () => sweepApplications(queue, now)],
    ["grievances", () => sweepGrievances(queue, now)],
    ["tickets", () => sweepTickets(queue, now)],
    ["rti", () => sweepRti(queue, now)],
  ];
  const counts: Record<string, number> = {};
  // One failing scan must not abort the others.
  for (const [name, fn] of tasks) {
    try {
      counts[name] = await fn();
    } catch (err) {
      counts[name] = -1;
      log?.error({ err, scan: name }, "sla sweep scan failed");
    }
  }
  log?.info({ counts }, "sla sweep tick complete");
}

/** Start the periodic SLA sweep. Returns the interval handle (clear on shutdown). */
export function startSlaSweep(
  queue: Queue,
  log?: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void },
): NodeJS.Timeout | null {
  if (!SWEEP_ENABLED) {
    log?.info({}, "sla sweep disabled (SLA_SWEEP_ENABLED=false)");
    return null;
  }
  // Kick once shortly after boot, then on the interval.
  setTimeout(() => { void runSlaSweep(queue, log); }, 10_000);
  const handle = setInterval(() => { void runSlaSweep(queue, log); }, SWEEP_INTERVAL_MS);
  log?.info({ intervalMs: SWEEP_INTERVAL_MS }, "sla sweep scheduler started");
  return handle;
}
