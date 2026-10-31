/**
 * UAT B9-hrms2 -- the disciplinary case-transition consumer applies only the
 * columns its transition owns, real Postgres + the real F3 consumer.
 *
 * Review follow-up to F71 (#2409): `reviveCasePatch` revived Date fields in the
 * F3 payload's `patch` and the consumer spread the whole object into the case
 * UPDATE with no column allow-list, so a crafted or buggy payload could rewrite
 * any column (allegation, created_by, case_no, ...). The consumer also trusted
 * the payload's target status `to`, so a stale/duplicate transition was
 * re-applied. Now each transition has an explicit allow-list (anything else is
 * refused, NonRetryable, nothing written) and the transition is re-validated
 * against the case's current status inside the write transaction.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { registerF3_disciplinary_Consumers } from "../src/modules/disciplinary/f3-consumer.js";
import { hrmsDisciplinaryCases, hrmsDisciplinaryEvents } from "../src/modules/disciplinary/schema.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const ALLEGATION = "B9-hrms2 original allegation";

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await sqlClient.end(); });

type Envelope = { messageId: string; payload: { patch: Record<string, unknown>; to: string; action: string } };

async function seedCase(status: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsDisciplinaryCases).values({
    id, tenantId: TENANT, employeeId: randomUUID(), caseNo: `DC-B9-${id.slice(0, 8)}`,
    proceedingType: "major", status, allegation: ALLEGATION, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

/** POST a charge memo through the real route; return the f3 envelope it published, as SQS would deliver it. */
async function chargeMemoEnvelope(caseId: string): Promise<Envelope> {
  const published: unknown[] = [];
  vi.spyOn(infraQueue, "publish").mockImplementation(async (topic: string, msg: unknown) => {
    if (topic === COMMANDS.f3RouteWrite) published.push(msg);
  });
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s-b9" }, SECRET);
  const app = await buildApp();
  const r = await app.inject({
    method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/charge-memo`,
    headers: { authorization: `Bearer ${token}` },
    payload: { chargeMemoRef: "CM/B9/1", chargeMemoDate: "2026-10-30", notes: "B9 charge memo" },
  });
  await app.close();
  expect(r.statusCode, r.body).toBe(200);
  expect(published).toHaveLength(1);
  return JSON.parse(JSON.stringify(published[0])) as Envelope;
}

async function deliver(envelope: unknown): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  registerF3_disciplinary_Consumers(q);
  await q.start();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await q.publish(COMMANDS.f3RouteWrite, envelope as any);
  await q.drain();
  await q.stop();
  return q;
}

async function readCase(caseId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withTenantScope(db, TENANT, async (tx: any) => {
    const [c] = await tx.select().from(hrmsDisciplinaryCases)
      .where(and(eq(hrmsDisciplinaryCases.tenantId, TENANT), eq(hrmsDisciplinaryCases.id, caseId)));
    const events = await tx.select().from(hrmsDisciplinaryEvents)
      .where(and(eq(hrmsDisciplinaryEvents.tenantId, TENANT), eq(hrmsDisciplinaryEvents.caseId, caseId)));
    return { c, events };
  });
}

describe("B9-hrms2: disciplinary transition patch is allow-listed per transition", () => {
  it("applies the charge memo's own columns", async () => {
    const caseId = await seedCase("opened");
    const q = await deliver(await chargeMemoEnvelope(caseId));
    expect(q.dlq).toEqual([]);
    const { c, events } = await readCase(caseId);
    expect(c).toMatchObject({ status: "charge_memo_issued", chargeMemoRef: "CM/B9/1", chargeMemoDate: "2026-10-30", version: 2 });
    expect(events).toHaveLength(1);
  });

  it("refuses (NonRetryable, nothing written) a patch carrying columns the transition does not own", async () => {
    const caseId = await seedCase("opened");
    const env = await chargeMemoEnvelope(caseId);
    env.payload.patch.allegation = "rewritten by a crafted payload";
    env.payload.patch.createdBy = randomUUID();
    env.payload.patch.caseNo = "DC-HIJACKED";
    const q = await deliver(env);

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/UNPATCHABLE_FIELD/);
    const { c, events } = await readCase(caseId);
    expect(c).toMatchObject({ status: "opened", allegation: ALLEGATION, createdBy: ACTOR, chargeMemoRef: null, version: 1 });
    expect(c.caseNo).not.toBe("DC-HIJACKED");
    expect(events).toHaveLength(0);
  });

  it("refuses a target status the transition cannot reach from the case's current status", async () => {
    const caseId = await seedCase("opened");
    const env = await chargeMemoEnvelope(caseId);
    env.payload.to = "closed";
    const q = await deliver(env);

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/WRONG_STATE/);
    const { c, events } = await readCase(caseId);
    expect(c).toMatchObject({ status: "opened", version: 1 });
    expect(events).toHaveLength(0);
  });

  it("a duplicate (re-published) transition is refused once the case has moved on", async () => {
    const caseId = await seedCase("opened");
    const env = await chargeMemoEnvelope(caseId);
    expect((await deliver(env)).dlq).toEqual([]);
    const q = await deliver({ ...env, messageId: randomUUID() });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/WRONG_STATE/);
    const { c, events } = await readCase(caseId);
    expect(c).toMatchObject({ status: "charge_memo_issued", version: 2 });
    expect(events).toHaveLength(1);
  });
});
