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
import { and, eq, lt, or, isNull, inArray } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { citizenApplications } from "../application/schema.js";
import { citizenGrievances } from "../grievance/schema.js";
import { citizenTickets } from "../helpdesk/schema.js";
import { citizenRtiRequests } from "../rti/schema.js";
import { GRIEVANCE_ESCALATION_SLA_DAYS } from "../grievance/domain.js";

const SWEEP_ENABLED = (process.env.SLA_SWEEP_ENABLED ?? "true") !== "false";
const SWEEP_INTERVAL_MS = Number(process.env.SLA_SWEEP_INTERVAL_MS ?? 5 * 60 * 1000);
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

const OPEN_APP_STATUSES = ["submitted", "under_review", "pending_docs"];
const OPEN_GRIEVANCE_STATUSES = ["registered", "assigned", "in_progress", "reopened"];
const OPEN_RTI_STATUSES = ["filed", "forwarded", "under_review"];

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

async function sweepApplications(queue: Queue, now: Date): Promise<number> {
  const rows = await db.select({
    id: citizenApplications.id, tenantId: citizenApplications.tenantId,
    serviceId: citizenApplications.serviceId,
  }).from(citizenApplications).where(and(
    inArray(citizenApplications.status, OPEN_APP_STATUSES),
    or(
      lt(citizenApplications.deadline, now.toISOString().slice(0, 10)),
      isNull(citizenApplications.deadline),
    ),
  )).limit(2000);
  let n = 0;
  for (const r of rows) {
    // maxDays=0 so the consumer's isSlaBreached compares against createdAt+0 and
    // the deadline already passed; consumer re-validates before emitting.
    await publishSlaCheck(queue, COMMANDS.applicationSlaCheck, r.tenantId, slaMessageId("app", r.id), {
      tenantId: r.tenantId, applicationId: r.id, serviceType: r.serviceId, maxDays: 0,
    });
    n++;
  }
  return n;
}

async function sweepGrievances(queue: Queue, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - GRIEVANCE_ESCALATION_SLA_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.select({
    id: citizenGrievances.id, tenantId: citizenGrievances.tenantId,
  }).from(citizenGrievances).where(and(
    inArray(citizenGrievances.status, OPEN_GRIEVANCE_STATUSES),
    lt(citizenGrievances.updatedAt, cutoff),
  )).limit(2000);
  let n = 0;
  for (const r of rows) {
    await publishSlaCheck(queue, COMMANDS.grievanceSlaCheck, r.tenantId, slaMessageId("griev", r.id), {
      tenantId: r.tenantId, grievanceId: r.id, slaDays: GRIEVANCE_ESCALATION_SLA_DAYS,
    });
    n++;
  }
  return n;
}

async function sweepTickets(queue: Queue, now: Date): Promise<number> {
  const rows = await db.select({
    id: citizenTickets.id, tenantId: citizenTickets.tenantId,
  }).from(citizenTickets).where(and(
    or(eq(citizenTickets.status, "open"), eq(citizenTickets.status, "in_progress")),
    lt(citizenTickets.slaDueAt, now),
  )).limit(2000);
  let n = 0;
  for (const r of rows) {
    await publishSlaCheck(queue, COMMANDS.ticketSlaCheck, r.tenantId, slaMessageId("ticket", r.id), {
      tenantId: r.tenantId, ticketId: r.id,
    });
    n++;
  }
  return n;
}

async function sweepRti(queue: Queue, now: Date): Promise<number> {
  const rows = await db.select({
    id: citizenRtiRequests.id, tenantId: citizenRtiRequests.tenantId,
  }).from(citizenRtiRequests).where(and(
    inArray(citizenRtiRequests.status, OPEN_RTI_STATUSES),
    lt(citizenRtiRequests.deadline, now.toISOString().slice(0, 10)),
  )).limit(2000);
  let n = 0;
  for (const r of rows) {
    await publishSlaCheck(queue, COMMANDS.rtiSlaCheck, r.tenantId, slaMessageId("rti", r.id), {
      tenantId: r.tenantId, rtiId: r.id,
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
