/**
 * Gap-fix wave (HANDOFF 5 item 7): the reject consumer, against a real DB (service role, forced RLS).
 * Covers the state machine (submitted -> rejected -> submitted -> approved), the mandatory reason, the
 * maker-checker refusal, idempotent redelivery, the persisted rejection fields and the audit record.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { isNonRetryable, type Queue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { registerReportsConsumers } from "../src/modules/reports/consumer.js";
import { findReportById } from "../src/modules/reports/repo.js";

const TENANT = "9a7f0000-0000-4000-8000-000000000063";
const INSPECTOR = randomUUID();
const OFFICER = randomUUID();
const OFFICER2 = randomUUID();

const T = {
  create: "inspection.report.create",
  submit: "inspection.report.submit",
  approve: "inspection.report.approve",
  reject: "inspection.report.reject",
  observe: "inspection.report.observation.add",
} as const;

const handlers = new Map<string, (msg: unknown) => Promise<void>>();
registerReportsConsumers({
  subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); },
} as unknown as Queue);

afterAll(async () => { await sqlClient.end(); });

function send(topic: string, actorId: string, payload: Record<string, unknown>, messageId: string = randomUUID()) {
  const h = handlers.get(topic);
  if (!h) throw new Error(`no consumer subscribed to ${topic}`);
  return runWithTenant(TENANT, () => h({
    messageId, type: topic, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  }));
}
async function failure(p: Promise<void>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  return undefined;
}
const row = (id: string) => runWithTenant(TENANT, () => findReportById(TENANT, id));

async function submittedReport(): Promise<string> {
  const id = randomUUID();
  await send(T.create, INSPECTOR, { id, tenantId: TENANT, inspectorId: INSPECTOR, inspectionId: randomUUID(), entityId: randomUUID() }, id);
  await send(T.submit, INSPECTOR, { id, tenantId: TENANT });
  return id;
}
const auditActions = async (id: string) => (await sqlClient.unsafe(
  `SELECT payload->>'action' AS action, payload->'details'->>'reason' AS reason FROM _outbox.messages WHERE tenant_id = $1 AND payload->>'resourceId' = $2`,
  [TENANT, id],
)) as unknown as Array<{ action: string; reason: string | null }>;

describe("inspection report rejection consumer", () => {
  it("submitted -> rejected records who, when and why, bumps the version and writes an audit record", async () => {
    const id = await submittedReport();
    await send(T.reject, OFFICER, { id, tenantId: TENANT, rejecterId: OFFICER, reason: "  Grade not supported by the observations  " });
    const r = await row(id);
    expect(r).toMatchObject({ status: "rejected", rejectedBy: OFFICER, rejectionReason: "Grade not supported by the observations", updatedBy: OFFICER, version: 3, approvedAt: null, approvedBy: null });
    expect(r?.rejectedAt).toBeInstanceOf(Date);
    const audit = await auditActions(id);
    expect(audit.map((a) => a.action)).toContain("inspection_report.rejected");
    expect(audit.find((a) => a.action === "inspection_report.rejected")?.reason).toBe("Grade not supported by the observations");
  });

  it("refuses a blank or too-short reason non-retryably and leaves the report submitted", async () => {
    const id = await submittedReport();
    for (const reason of [undefined, "", "    ", "no"]) {
      const err = await failure(send(T.reject, OFFICER, { id, tenantId: TENANT, reason }));
      expect(isNonRetryable(err)).toBe(true);
    }
    expect((await row(id))?.status).toBe("submitted");
  });

  it("refuses rejection by the report's inspector or its submitter (maker-checker)", async () => {
    const id = await submittedReport();
    const byInspector = await failure(send(T.reject, INSPECTOR, { id, tenantId: TENANT, reason: "rejecting my own report" }));
    expect(isNonRetryable(byInspector)).toBe(true);
    expect(String((byInspector as Error).message)).toMatch(/maker-checker/i);

    const id2 = randomUUID();
    const submitter = randomUUID();
    await send(T.create, INSPECTOR, { id: id2, tenantId: TENANT, inspectorId: INSPECTOR, inspectionId: randomUUID(), entityId: randomUUID() }, id2);
    await send(T.submit, submitter, { id: id2, tenantId: TENANT });
    const bySubmitter = await failure(send(T.reject, submitter, { id: id2, tenantId: TENANT, reason: "rejecting what I submitted" }));
    expect(isNonRetryable(bySubmitter)).toBe(true);
    expect((await row(id))?.status).toBe("submitted");
    expect((await row(id2))?.status).toBe("submitted");
  });

  it("only a submitted report can be rejected (draft and approved are refused)", async () => {
    const draft = randomUUID();
    await send(T.create, INSPECTOR, { id: draft, tenantId: TENANT, inspectorId: INSPECTOR, inspectionId: randomUUID(), entityId: randomUUID() }, draft);
    expect(isNonRetryable(await failure(send(T.reject, OFFICER, { id: draft, tenantId: TENANT, reason: "reject a draft" })))).toBe(true);
    expect((await row(draft))?.status).toBe("draft");

    const approved = await submittedReport();
    await send(T.approve, OFFICER, { id: approved, tenantId: TENANT, approverId: OFFICER });
    expect(isNonRetryable(await failure(send(T.reject, OFFICER2, { id: approved, tenantId: TENANT, reason: "reject an approved one" })))).toBe(true);
    expect((await row(approved))?.status).toBe("approved");
  });

  it("a redelivery under a fresh message id is a no-op (one version bump, one audit record)", async () => {
    const id = await submittedReport();
    const payload = { id, tenantId: TENANT, reason: "Missing evidence for observation 2" };
    await send(T.reject, OFFICER, payload);
    await send(T.reject, OFFICER, payload);
    expect((await row(id))?.version).toBe(3);
    expect((await auditActions(id)).filter((a) => a.action === "inspection_report.rejected")).toHaveLength(1);
  });

  it("is resubmittable: rejected -> (revise) -> submitted -> approved by a different officer; the last rejection stays on the row", async () => {
    const id = await submittedReport();
    await send(T.reject, OFFICER, { id, tenantId: TENANT, reason: "Add evidence for the fire exits" });
    // revise: observations are still accepted on a rejected report
    await send(T.observe, INSPECTOR, { id: randomUUID(), tenantId: TENANT, reportId: id, category: "fire", severity: "major", description: "Exit blocked" });
    await send(T.submit, INSPECTOR, { id, tenantId: TENANT });
    expect(await row(id)).toMatchObject({ status: "submitted", rejectionReason: "Add evidence for the fire exits", rejectedBy: OFFICER });
    // the officer who rejected it may review again (they are not a maker); the inspector may not
    expect(isNonRetryable(await failure(send(T.approve, INSPECTOR, { id, tenantId: TENANT, approverId: INSPECTOR })))).toBe(true);
    await send(T.approve, OFFICER2, { id, tenantId: TENANT, approverId: OFFICER2 });
    expect(await row(id)).toMatchObject({ status: "approved", approvedBy: OFFICER2 });
  });

  it("a rejected report cannot be approved without being resubmitted", async () => {
    const id = await submittedReport();
    await send(T.reject, OFFICER, { id, tenantId: TENANT, reason: "Redo the summary" });
    expect(isNonRetryable(await failure(send(T.approve, OFFICER2, { id, tenantId: TENANT, approverId: OFFICER2 })))).toBe(true);
    expect((await row(id))?.status).toBe("rejected");
  });
});
