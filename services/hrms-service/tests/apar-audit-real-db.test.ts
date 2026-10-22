/**
 * GAP-HR-AUDIT-LOG-08 -- APAR audit events, real Postgres, real F3 consumer
 * (MemoryQueue, no mocks).
 *
 * The HR audit-log page reads the central audit trail. APAR used to add
 * nothing to it: apar/f3-consumer.ts imported `enqueue` and never called it, and
 * the audit handlers in apar/consumer.ts have no publisher. This drives the
 * whole appraisal chain (initiate, self-appraisal, reporting, reviewing,
 * accept, representation, finalise) through the real consumer and reads
 * `_outbox.messages` back to prove, per mutation:
 *   - exactly one `audit.event.record`, written with the state change;
 *   - tenant + actor on the envelope, ids/stage names only in the payload;
 *   - a redelivered command adds nothing, and a rejected one leaves neither an
 *     audit row nor a processed marker (they commit or roll back together).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { hrmsAppraisals } from "../src/modules/appraisals/schema.js";
import { hrmsAparStageHistory } from "../src/modules/apar/schema.js";
import { registerF3_apar_Consumers } from "../src/modules/apar/f3-consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();

// Actor ids (JWT sub) are deliberately unrelated to the hrms_employees.id values
// on the appraisal; only each employee row's userRef links them, like production.
const HR_ACTOR = randomUUID();
const ACTORS = { emp: randomUUID(), ro: randomUUID(), rv: randomUUID(), aa: randomUUID() };

const FREE_TEXT = ["TEXT-SELF-APPRAISAL", "TEXT-PEN-PICTURE", "TEXT-SCORE-REMARK", "TEXT-REVIEW-REMARKS", "TEXT-ACCEPT-REMARKS", "TEXT-REPRESENTATION"];

type AuditRow = { actor_id: string; tenant_id: string; topic: string; event_type: string; payload: Record<string, unknown> };

async function seedEmployee(userRef: string, name: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT, employeeNo: `AUD-${id.slice(0, 8)}`, fullName: name,
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
    userRef, createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));
  return id;
}

async function send(
  op: string, actorId: string, payload: Record<string, unknown>, opts: { messageId?: string; id?: string } = {},
): Promise<{ dlq: unknown[]; messageId: string }> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (m: any) => Promise<void>) =>
    raw(topic, (m: any) => runWithTenant(m.tenantId, () => handler(m)));
  registerF3_apar_Consumers(q);
  await q.start();
  const messageId = opts.messageId ?? randomUUID();
  await q.publish(COMMANDS.f3RouteWrite, {
    messageId, type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId, correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0", payload: { op, id: opts.id ?? randomUUID(), tenantId: TENANT, query: {}, ...payload },
  });
  await q.drain();
  const dlq = [...q.dlq];
  await q.stop();
  return { dlq, messageId };
}

async function auditRows(resourceId: string): Promise<AuditRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await withTenantScope(db, TENANT, (tx: any) => tx.execute(sql`
    SELECT actor_id::text AS actor_id, tenant_id::text AS tenant_id, topic, event_type, payload
      FROM _outbox.messages
     WHERE tenant_id = ${TENANT}::uuid AND payload->>'resourceType' = 'apar' AND payload->>'resourceId' = ${resourceId}
     ORDER BY created_at, id
  `))) as unknown as AuditRow[];
}

async function processedCount(messageId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await withTenantScope(db, TENANT, (tx: any) => tx.execute(sql`
    SELECT 1 FROM _inbox.processed WHERE message_id = ${messageId}::uuid
  `))) as unknown as unknown[];
  return rows.length;
}

afterAll(async () => { await sqlClient.end(); });

describe("APAR audit events (real DB, real consumer)", () => {
  it("each of the seven mutations emits exactly one audit.event.record with the right actor, ids only", async () => {
    const [emp, ro, rv, aa] = await Promise.all([
      seedEmployee(ACTORS.emp, "Appraisee"), seedEmployee(ACTORS.ro, "Reporting"),
      seedEmployee(ACTORS.rv, "Reviewing"), seedEmployee(ACTORS.aa, "Accepting"),
    ]);
    const aparId = randomUUID();
    const steps: Array<{ action: string; actor: string; res: { dlq: unknown[] } }> = [];

    steps.push({ action: "create", actor: HR_ACTOR, res: await send("apar_routes__0", HR_ACTOR, {
      params: {}, body: { employeeId: emp, appraisalPeriod: "2026-27", reportingOfficerId: ro, reviewingOfficerId: rv, acceptingAuthorityId: aa },
    }, { id: aparId }) });
    steps.push({ action: "self_appraisal", actor: ACTORS.emp, res: await send("apar_routes__1", ACTORS.emp, {
      params: { id: aparId }, body: { selfAppraisal: "TEXT-SELF-APPRAISAL" },
    }) });
    steps.push({ action: "reporting", actor: ACTORS.ro, res: await send("apar_routes__2", ACTORS.ro, {
      params: { id: aparId }, body: { penPicture: "TEXT-PEN-PICTURE", scores: [
        { attribute: "integrity", weight: 60, score: 9, remarks: "TEXT-SCORE-REMARK" }, { attribute: "leadership", weight: 40, score: 8 },
      ] },
    }) });
    steps.push({ action: "reviewing", actor: ACTORS.rv, res: await send("apar_routes__3", ACTORS.rv, {
      params: { id: aparId }, body: { decision: "vary", remarks: "TEXT-REVIEW-REMARKS", variations: [{ attribute: "integrity", score: 8 }] },
    }) });
    steps.push({ action: "accept", actor: ACTORS.aa, res: await send("apar_routes__4", ACTORS.aa, {
      params: { id: aparId }, body: { remarks: "TEXT-ACCEPT-REMARKS" },
    }) });
    steps.push({ action: "representation", actor: ACTORS.emp, res: await send("apar_routes__5", ACTORS.emp, {
      params: { id: aparId }, body: { representation: "TEXT-REPRESENTATION" },
    }) });
    steps.push({ action: "finalise", actor: HR_ACTOR, res: await send("apar_routes__6", HR_ACTOR, {
      params: { id: aparId }, body: {},
    }) });
    for (const s of steps) expect(s.res.dlq, `${s.action} landed in the DLQ`).toEqual([]);

    // The chain really ran: the audit rows describe writes that happened.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [appraisal] = await withTenantScope(db, TENANT, (tx: any) => tx.select().from(hrmsAppraisals).where(eq(hrmsAppraisals.id, aparId)));
    expect(appraisal.status).toBe("finalised");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history = await withTenantScope(db, TENANT, (tx: any) => tx.select().from(hrmsAparStageHistory).where(eq(hrmsAparStageHistory.appraisalId, aparId)));
    expect(history).toHaveLength(7);

    const rows = await auditRows(aparId);
    expect(rows.map((r) => r.payload.action)).toEqual(steps.map((s) => s.action));
    rows.forEach((r, i) => {
      expect(r.tenant_id).toBe(TENANT);
      expect(r.actor_id).toBe(steps[i]!.actor);
      expect(r.topic).toBe("audit.event.record");
      expect(r.event_type).toBe("audit.event.record");
      expect(r.payload).toMatchObject({ service: "hrms", resourceType: "apar", resourceId: aparId, outcome: "success", employeeId: emp });
    });
    expect(rows[0]!.payload).toMatchObject({ appraisalPeriod: "2026-27", fromStage: null, toStage: "self_pending" });
    expect(rows[1]!.payload).toMatchObject({ fromStage: "self_pending", toStage: "reporting_officer", actorRole: "appraisee", override: false });
    expect(rows[2]!.payload).toMatchObject({ fromStage: "reporting_officer", toStage: "reviewing_officer", actorRole: "reporting_officer", scoreCount: 2 });
    expect(rows[3]!.payload).toMatchObject({ toStage: "accepting_authority", decision: "vary", variationCount: 1 });
    expect(rows[4]!.payload).toMatchObject({ fromStage: "accepting_authority", toStage: "disclosed", actorRole: "accepting_authority" });
    expect(rows[5]!.payload).toMatchObject({ fromStage: "disclosed", toStage: "representation" });
    expect(rows[6]!.payload).toMatchObject({ fromStage: "representation", toStage: "finalised", actorRole: "hr" });

    // Ids and stage names only: no appraisal text, no grade.
    const wire = JSON.stringify(rows);
    for (const t of FREE_TEXT) expect(wire, `${t} leaked into the audit trail`).not.toContain(t);
    expect(wire).not.toMatch(/overallGrade|overallBand|Very Good|Outstanding/);
  });

  it("a redelivered command (same messageId) adds no second audit row", async () => {
    const emp = await seedEmployee(randomUUID(), "Appraisee 2");
    const aparId = randomUUID();
    const first = await send("apar_routes__0", HR_ACTOR, {
      params: {}, body: { employeeId: emp, appraisalPeriod: "2026-27", reportingOfficerId: randomUUID(), reviewingOfficerId: randomUUID(), acceptingAuthorityId: randomUUID() },
    }, { id: aparId });
    expect(first.dlq).toEqual([]);
    expect(await auditRows(aparId)).toHaveLength(1);

    const replay = await send("apar_routes__0", HR_ACTOR, {
      params: {}, body: { employeeId: emp, appraisalPeriod: "2026-27", reportingOfficerId: randomUUID(), reviewingOfficerId: randomUUID(), acceptingAuthorityId: randomUUID() },
    }, { id: aparId, messageId: first.messageId });
    expect(replay.dlq).toEqual([]);
    expect(await auditRows(aparId)).toHaveLength(1);
  });

  it("a rejected command leaves no audit row and no processed marker (they roll back together)", async () => {
    const ghost = randomUUID(); // no such appraisal
    const res = await send("apar_routes__6", HR_ACTOR, { params: { id: ghost }, body: {} });
    expect(res.dlq).toHaveLength(1);
    expect(await auditRows(ghost)).toHaveLength(0);
    expect(await processedCount(res.messageId)).toBe(0);
  });
});
