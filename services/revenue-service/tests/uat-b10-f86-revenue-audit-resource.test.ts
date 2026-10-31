/**
 * UAT B10-F86: every revenue audit event names its resource.
 *
 * Live UAT (T5 H4): remission requests and decisions were audited against the
 * ASSESSMENT, so no audit event targeted a remission row (0/5), and refund
 * and write-off create/decide events carried no resourceId at all, so the
 * audit trail could not say which refund or write-off was approved.
 *
 * DB-backed, no mocks: real consumers through a MemoryQueue, assertions on the
 * audit payload written to the transactional outbox (what audit-service
 * stores as the event target).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { assessments, dcbEntries, demands, remissions } from "../src/modules/assessment/schema.js";
import { receipts, refunds } from "../src/modules/collection/schema.js";
import { writeOffs } from "../src/modules/arrears/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerAssessmentConsumers } from "../src/modules/assessment/consumer.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "b10f8600-0000-4000-8000-0000000f8600";
const ASSESSEE = "b10f8600-0000-4000-8000-0000000000ee";
const ASSESSMENT = "b10f8600-0000-4000-8000-0000000a5500";
const DEMAND = "b10f8600-0000-4000-8000-0000000de111";
const RECEIPT = "b10f8600-0000-4000-8000-0000000000c1";
const HEAD = "b10f8600-0000-4000-8000-0000000a0a0a";
const MAKER = "b10f8600-0000-4000-8000-00000000a000";
const CHECKER = "b10f8600-0000-4000-8000-0000000c0ec0";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
const msg = (type: string, actorId: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});
const inTenant = <T>(fn: Parameters<typeof db.transaction>[0]) => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;

async function clean() {
  await inTenant(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(remissions).where(eq(remissions.tenantId, TENANT));
    await tx.delete(assessments).where(eq(assessments.tenantId, TENANT));
    await tx.delete(refunds).where(eq(refunds.tenantId, TENANT));
    await tx.delete(receipts).where(eq(receipts.tenantId, TENANT));
    await tx.delete(writeOffs).where(eq(writeOffs.tenantId, TENANT));
    await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
    await tx.delete(demands).where(eq(demands.tenantId, TENANT));
  });
}
async function seed() {
  await inTenant(async (tx) => {
    await tx.insert(assessments).values({
      id: ASSESSMENT, tenantId: TENANT, assesseeId: ASSESSEE, rateHeadId: HEAD, financialYear: "2026-27",
      baseValue: 1_000_000n, exemptions: [], status: "active", createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(demands).values({
      id: DEMAND, tenantId: TENANT, assesseeId: ASSESSEE, assessmentId: ASSESSMENT, rateHeadId: HEAD,
      financialYear: "2026-27", dueDate: "2026-06-30", principalMinor: 500_000n, netMinor: 500_000n,
      computeSnapshot: {}, createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(dcbEntries).values({
      id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND, entryType: "demand",
      amountMinor: 500_000n, balanceMinor: 500_000n, referenceType: "demand", narration: "fixture", createdBy: MAKER,
    });
    await tx.insert(receipts).values({
      id: RECEIPT, tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND, amountMinor: 100_000n,
      channel: "counter", reference: "REF-B10-F86", receiptNo: "RCT-B10-1", createdBy: MAKER, updatedBy: MAKER,
    });
  });
}
async function start(): Promise<MemoryQueue> {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerAssessmentConsumers(q);
  registerCollectionConsumers(q);
  registerArrearsConsumers(q);
  await q.start();
  return q;
}
async function send(q: MemoryQueue, type: string, actor: string, payload: Record<string, unknown>) {
  await q.publish(type, msg(type, actor, payload));
  await q.drain();
}
const audits = async () =>
  (await inTenant<Array<{ payload: unknown }>>((tx) => tx.select().from(outboxMessages)
    .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record")))))
    .map((r) => r.payload as Record<string, unknown>);
const auditFor = async (resourceType: string, action: string) => (await audits()).filter((p) => p.resourceType === resourceType && p.action === action);

beforeAll(clean);
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("UAT B10-F86 remission audit", () => {
  it("the request and the decision are audited against the remission row", async () => {
    const q = await start();
    await send(q, COMMANDS.assessmentRemit, MAKER, { assessmentId: ASSESSMENT, reason: "Hardship", remissionPercent: 10 });
    const [rem] = await inTenant<Array<{ id: string }>>((tx) => tx.select().from(remissions).where(eq(remissions.tenantId, TENANT)));
    expect(rem).toBeDefined();

    const [remit] = await auditFor("remission", "remit");
    expect(remit).toMatchObject({
      service: "revenue", resourceType: "remission", resourceId: rem!.id, outcome: "pending",
      assessmentId: ASSESSMENT, remissionPercent: 10,
    });

    await send(q, COMMANDS.assessmentRemitDecide, CHECKER, { assessmentId: ASSESSMENT, approve: true });
    const [decide] = await auditFor("remission", "remit_decide");
    expect(decide).toMatchObject({
      resourceType: "remission", resourceId: rem!.id, outcome: "approved", assessmentId: ASSESSMENT, makerUserId: MAKER,
    });
    await q.stop();
  });
});

describe("UAT B10-F86 refund approval audit", () => {
  it("create and approve both name the refund (and the receipt it refunds)", async () => {
    const q = await start();
    await send(q, COMMANDS.refundCreate, MAKER, { receiptId: RECEIPT, reason: "excess paid", amountMinor: "40000" });
    const [refund] = await inTenant<Array<{ id: string }>>((tx) => tx.select().from(refunds).where(eq(refunds.tenantId, TENANT)));
    expect(refund).toBeDefined();
    expect((await auditFor("refund", "create"))[0]).toMatchObject({ resourceId: refund!.id, receiptId: RECEIPT, amountMinor: "40000" });

    await send(q, COMMANDS.refundDecide, CHECKER, { refundId: refund!.id, approve: true });
    const [decide] = await auditFor("refund", "decide");
    expect(decide).toMatchObject({
      resourceType: "refund", resourceId: refund!.id, outcome: "approved", receiptId: RECEIPT, amountMinor: "40000",
    });
    await q.stop();
  });
});

describe("UAT B10-F86 write-off approval audit", () => {
  it("create and approve both name the write-off (and the demand it reduces)", async () => {
    const q = await start();
    await send(q, COMMANDS.writeOffCreate, MAKER, { assesseeId: ASSESSEE, demandId: DEMAND, amountMinor: "50000", reason: "irrecoverable" });
    const [wo] = await inTenant<Array<{ id: string }>>((tx) => tx.select().from(writeOffs).where(eq(writeOffs.tenantId, TENANT)));
    expect(wo).toBeDefined();
    expect((await auditFor("write_off", "create"))[0]).toMatchObject({ resourceId: wo!.id, demandId: DEMAND, amountMinor: "50000" });

    await send(q, COMMANDS.writeOffDecide, CHECKER, { writeOffId: wo!.id, approve: true });
    const [decide] = await auditFor("write_off", "decide");
    expect(decide).toMatchObject({
      resourceType: "write_off", resourceId: wo!.id, outcome: "approved", demandId: DEMAND, amountMinor: "50000",
    });
    await q.stop();
  });
});

/** Static guard: no revenue audit enqueue may omit the resource reference. */
describe("UAT B10-F86 every revenue audit event carries resourceType and resourceId", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      // shared/audit.ts is enqueueAudit() itself, whose type makes resourceId mandatory.
      else if (p.endsWith(".ts") && !p.endsWith(join("shared", "audit.ts"))) files.push(p);
    }
  };
  walk(join(__dirname, "..", "src"));

  it("scans every enqueue of audit.event.record", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const re = /topic:\s*(?:["']audit\.event\.record["']|AUDIT_TOPIC)\s*,/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        seen += 1;
        const end = src.indexOf("});", m.index);
        const block = src.slice(m.index, end === -1 ? undefined : end);
        if (!/resourceType:/.test(block) || !/resourceId:/.test(block)) {
          offenders.push(`${f.split("/src/")[1]}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });
});
