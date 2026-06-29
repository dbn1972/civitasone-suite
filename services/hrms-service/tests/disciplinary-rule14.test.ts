/**
 * R19 — CCS (CCA) Rule 14: a MAJOR penalty cannot be imposed on a single
 * eOffice approval. The formal inquiry (charge memo → inquiry officer →
 * recorded finding) must be complete first. Minor penalties (Rule 16) need no
 * oral inquiry.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsDisciplinaryCases, hrmsDisciplinaryEvents } from "../src/modules/disciplinary/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerDisciplinaryEOfficeConsumers } from "../src/modules/disciplinary/eoffice-consumer.js";
import { assertMajorPenaltyInquiry } from "../src/modules/disciplinary/state-machine.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const EMP = randomUUID();

function caseRow(id: string, over: Partial<typeof hrmsDisciplinaryCases.$inferInsert>) {
  return {
    id, tenantId: TENANT, employeeId: EMP, caseNo: `DC/${id.slice(0, 6)}`,
    proceedingType: "major", status: "pending_approval",
    allegation: "Unauthorised absence and misconduct",
    createdBy: ACTOR, updatedBy: ACTOR, ...over,
  };
}

function decided(caseId: string) {
  const msgId = randomUUID();
  return {
    messageId: msgId, type: CONSUMED_EVENTS.disciplinaryFileDecided,
    tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${caseId.slice(0, 6)}`, schemaVersion: "1.0",
    payload: {
      fileId: randomUUID(), fileNo: "EST/DISC/2026/1", refType: "hr_disciplinary",
      refId: caseId, decision: "approved", decidedBy: ACTOR, decidedAt: new Date().toISOString(),
    },
    _msgId: msgId,
  };
}

async function statusOf(id: string): Promise<string | undefined> {
  const r = (await db.select().from(hrmsDisciplinaryCases).where(eq(hrmsDisciplinaryCases.id, id)))[0];
  return r?.status;
}
async function actionsOf(id: string): Promise<string[]> {
  const rows = await db.select().from(hrmsDisciplinaryEvents).where(eq(hrmsDisciplinaryEvents.caseId, id));
  return rows.map((e) => e.action);
}
async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); }
}

beforeEach(async () => {
  await db.delete(hrmsDisciplinaryEvents).where(eq(hrmsDisciplinaryEvents.tenantId, TENANT));
  await db.delete(hrmsDisciplinaryCases).where(eq(hrmsDisciplinaryCases.tenantId, TENANT));
});
afterAll(async () => {
  await db.delete(hrmsDisciplinaryEvents).where(eq(hrmsDisciplinaryEvents.tenantId, TENANT));
  await db.delete(hrmsDisciplinaryCases).where(eq(hrmsDisciplinaryCases.tenantId, TENANT));
  await sqlClient.end();
});

describe("Rule 14 gate (pure)", () => {
  it("passes a minor proceeding without inquiry", () => {
    expect(assertMajorPenaltyInquiry({ proceedingType: "minor", penaltyType: "censure" }).ok).toBe(true);
  });
  it("blocks a major proceeding with no inquiry record", () => {
    const r = assertMajorPenaltyInquiry({ proceedingType: "major", penaltyType: "dismissal" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/charge memo/);
  });
  it("passes a major proceeding once charge memo + inquiry officer + finding are recorded", () => {
    expect(assertMajorPenaltyInquiry({
      proceedingType: "major", penaltyType: "dismissal",
      chargeMemoRef: "CM-1", inquiryOfficerId: randomUUID(), finding: "guilty", findingDate: "2026-05-01",
    }).ok).toBe(true);
  });
});

describe("disciplinary eOffice approval — Rule 14 imposition gate (R19)", () => {
  it("blocks imposing a MAJOR penalty when the inquiry is incomplete", async () => {
    const id = randomUUID();
    await db.insert(hrmsDisciplinaryCases).values(caseRow(id, { proceedingType: "major", penaltyType: "dismissal" }));
    const q = new MemoryQueue();
    registerDisciplinaryEOfficeConsumers(q);
    await q.start();
    const m = decided(id);
    await q.publish(CONSUMED_EVENTS.disciplinaryFileDecided, m);
    await waitFor(async () => (await db.select().from(processed).where(eq(processed.messageId, m._msgId))).length === 1);
    await q.stop();

    expect(await statusOf(id)).toBe("pending_approval"); // NOT imposed
    expect(await actionsOf(id)).toContain("major_penalty_blocked_rule14");
  });

  it("imposes a MAJOR penalty once the inquiry is complete", async () => {
    const id = randomUUID();
    await db.insert(hrmsDisciplinaryCases).values(caseRow(id, {
      proceedingType: "major", penaltyType: "dismissal",
      chargeMemoRef: "CM-9", inquiryOfficerId: randomUUID(), finding: "guilty", findingDate: "2026-05-01",
    }));
    const q = new MemoryQueue();
    registerDisciplinaryEOfficeConsumers(q);
    await q.start();
    const m = decided(id);
    await q.publish(CONSUMED_EVENTS.disciplinaryFileDecided, m);
    await waitFor(async () => (await db.select().from(processed).where(eq(processed.messageId, m._msgId))).length === 1);
    await q.stop();

    expect(await statusOf(id)).toBe("penalty_imposed");
    expect(await actionsOf(id)).toContain("impose_penalty");
  });

  it("imposes a MINOR penalty without requiring an inquiry", async () => {
    const id = randomUUID();
    await db.insert(hrmsDisciplinaryCases).values(caseRow(id, { proceedingType: "minor", penaltyType: "censure" }));
    const q = new MemoryQueue();
    registerDisciplinaryEOfficeConsumers(q);
    await q.start();
    const m = decided(id);
    await q.publish(CONSUMED_EVENTS.disciplinaryFileDecided, m);
    await waitFor(async () => (await db.select().from(processed).where(eq(processed.messageId, m._msgId))).length === 1);
    await q.stop();

    expect(await statusOf(id)).toBe("penalty_imposed");
  });
});
