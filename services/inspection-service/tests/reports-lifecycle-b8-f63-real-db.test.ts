/**
 * UAT bundle 8 F63: POST /reports/:id/submit, /approve and /observations answered 202 but nothing
 * subscribed to inspection.report.submit / .approve / .observation.add — a report could never leave
 * `draft` and no observation row was ever written. Real-DB: drives the registered consumers.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { isNonRetryable, type Queue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { registerReportsConsumers } from "../src/modules/reports/consumer.js";
import { findReportById, listObservations } from "../src/modules/reports/repo.js";

const TENANT = "b8f63000-0000-4000-8000-000000000063";
const INSPECTOR = randomUUID();
const CHECKER = randomUUID();

const T = {
  create: "inspection.report.create",
  submit: "inspection.report.submit",
  approve: "inspection.report.approve",
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
async function rejection(p: Promise<void>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  return undefined;
}
const status = async (id: string) => (await runWithTenant(TENANT, () => findReportById(TENANT, id)))?.status;

async function draftReport(): Promise<string> {
  const id = randomUUID();
  await send(T.create, INSPECTOR, {
    id, tenantId: TENANT, inspectorId: INSPECTOR, inspectionId: randomUUID(), entityId: randomUUID(),
  }, id);
  return id;
}

describe("inspection report lifecycle consumers (UAT b8 F63)", () => {
  it("submit moves draft → submitted", async () => {
    const id = await draftReport();
    await send(T.submit, INSPECTOR, { id, tenantId: TENANT });
    const row = await runWithTenant(TENANT, () => findReportById(TENANT, id));
    expect(row).toMatchObject({ status: "submitted", updatedBy: INSPECTOR, version: 2 });
    expect(row?.submittedAt).toBeInstanceOf(Date);
  });

  it("refuses self-approval (maker = checker) with a non-retryable error", async () => {
    const id = await draftReport();
    await send(T.submit, INSPECTOR, { id, tenantId: TENANT });
    const err = await rejection(send(T.approve, INSPECTOR, { id, tenantId: TENANT, approverId: INSPECTOR }));
    expect(isNonRetryable(err)).toBe(true);
    expect(String((err as Error).message)).toMatch(/maker-checker/i);
    expect(await status(id)).toBe("submitted");
  });

  it("refuses approval by a distinct submitter (submitter is a maker too)", async () => {
    const id = await draftReport();
    const submitter = randomUUID();
    await send(T.submit, submitter, { id, tenantId: TENANT });
    const err = await rejection(send(T.approve, submitter, { id, tenantId: TENANT, approverId: submitter }));
    expect(isNonRetryable(err)).toBe(true);
    expect(await status(id)).toBe("submitted");
  });

  it("a distinct approver moves submitted → approved", async () => {
    const id = await draftReport();
    await send(T.submit, INSPECTOR, { id, tenantId: TENANT });
    await send(T.approve, CHECKER, { id, tenantId: TENANT, approverId: CHECKER });
    const row = await runWithTenant(TENANT, () => findReportById(TENANT, id));
    expect(row).toMatchObject({ status: "approved", approvedBy: CHECKER, version: 3 });
    expect(row?.approvedAt).toBeInstanceOf(Date);
  });

  it("add-observation writes an observation row (idempotent on redelivery)", async () => {
    const id = await draftReport();
    const obsId = randomUUID();
    const evidence = randomUUID();
    const payload = {
      id: obsId, tenantId: TENANT, reportId: id, category: "fire_safety", severity: "major",
      description: "Extinguisher expired", location: "Ground floor", evidenceIds: [evidence],
    };
    await send(T.observe, INSPECTOR, payload, obsId);
    await send(T.observe, INSPECTOR, payload, obsId);
    const rows = await runWithTenant(TENANT, () => listObservations(TENANT, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: obsId, reportId: id, category: "fire_safety", severity: "major", status: "open",
      location: "Ground floor", evidenceIds: [evidence], createdBy: INSPECTOR,
    });
  });

  it("rejects invalid transitions non-retryably (approve a draft; re-submit an approved report)", async () => {
    const id = await draftReport();
    const err1 = await rejection(send(T.approve, CHECKER, { id, tenantId: TENANT, approverId: CHECKER }));
    expect(isNonRetryable(err1)).toBe(true);
    expect(await status(id)).toBe("draft");

    await send(T.submit, INSPECTOR, { id, tenantId: TENANT });
    await send(T.approve, CHECKER, { id, tenantId: TENANT, approverId: CHECKER });
    const err2 = await rejection(send(T.submit, INSPECTOR, { id, tenantId: TENANT }));
    expect(isNonRetryable(err2)).toBe(true);
    const err3 = await rejection(send(T.observe, INSPECTOR, {
      id: randomUUID(), tenantId: TENANT, reportId: id, category: "x", severity: "minor", description: "late",
    }));
    expect(isNonRetryable(err3)).toBe(true);
    expect(await status(id)).toBe("approved");
    expect(await runWithTenant(TENANT, () => listObservations(TENANT, id))).toHaveLength(0);
  });

  it("a missing report is non-retryable, not retried forever", async () => {
    const err = await rejection(send(T.submit, INSPECTOR, { id: randomUUID(), tenantId: TENANT }));
    expect(isNonRetryable(err)).toBe(true);
  });
});
