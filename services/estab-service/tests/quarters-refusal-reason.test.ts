/**
 * GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01 (UAT B4): a lifecycle command the consumer refuses
 * (maker-checker, illegal transition, stale version) is recorded on the allotment so the officer
 * can be told WHY nothing changed. Real Postgres (estab_svc, FORCE RLS); commands are delivered
 * straight to the consumer inside the message's tenant context, exactly as the worker does.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { estabQuarters, estabQuarterAllotments } from "../src/modules/quarters/schema.js";
import * as queries from "../src/modules/quarters/queries.js";
import { registerQuarterConsumers } from "../src/modules/quarters/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OFFICER = randomUUID();
const APPLICANT = randomUUID();

type Handler = (msg: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();
const fakeQueue = { subscribe: (t: string, h: Handler) => void handlers.set(t, h) } as unknown as Queue;

async function deliver(topic: string, actorId: string, payload: Record<string, unknown>): Promise<void> {
  const h = handlers.get(topic);
  if (!h) throw new Error("no handler " + topic);
  await runWithTenant(TENANT, () =>
    h({ messageId: randomUUID(), type: topic, tenantId: TENANT, actorId, correlationId: "corr-refusal", schemaVersion: "1.0", payload }));
}

let app: FastifyInstance;
let quarterId: string;
let allotmentId: string;

const hdr = () => ({ authorization: `Bearer ${signToken({ sub: OFFICER, tid: TENANT, roles: ["estab_admin"], sid: "s" }, SECRET, 3600)}` });
type Allotment = { status: string; version: number; lastCommandErrorCode: string | null; lastCommandErrorCommand: string | null; lastCommandErrorAt: string | Date | null };
const getAllotment = async () =>
  (await runWithTenant(TENANT, () => queries.getAllotment(TENANT, allotmentId))) as unknown as Allotment;
const quarterStatus = async () =>
  (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(estabQuarters).where(eq(estabQuarters.id, quarterId)))))[0]!.status;

beforeAll(async () => {
  registerQuarterConsumers(fakeQueue);
  app = await buildApp();
  await app.ready();
  quarterId = randomUUID();
  allotmentId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(estabQuarters).values({
      id: quarterId, tenantId: TENANT, quarterNo: `RJ-${quarterId.slice(0, 6)}`, quarterType: "type_iv",
      status: "vacant", createdBy: OFFICER, updatedBy: OFFICER,
    });
    await tx.insert(estabQuarterAllotments).values({
      id: allotmentId, tenantId: TENANT, quarterId, employeeRef: APPLICANT, payLevel: "10",
      status: "waitlisted", version: 1, createdBy: APPLICANT, updatedBy: APPLICANT,
    });
  }));
});
afterAll(async () => { await app.close(); });

describe("allotment command refusals are recorded", () => {
  it("starts with no refusal", async () => {
    const a = await getAllotment();
    expect(a.status).toBe("waitlisted");
    expect(a.lastCommandErrorCode).toBeNull();
  });

  it("maker-checker: the applicant allotting their own application is refused with a stored code", async () => {
    await deliver(COMMANDS.quarterAllot, APPLICANT, { id: allotmentId, tenantId: TENANT, version: 1 });
    const a = await getAllotment();
    expect(a.status).toBe("waitlisted");
    expect(a.version).toBe(1);
    expect(a.lastCommandErrorCode).toBe("MAKER_CHECKER_VIOLATION");
    expect(a.lastCommandErrorCommand).toBe("allot");
    expect(a.lastCommandErrorAt).toBeTruthy();
    expect(await quarterStatus()).toBe("vacant");
  });

  it("an illegal transition is refused and recorded (occupy before allot)", async () => {
    await deliver(COMMANDS.quarterOccupy, OFFICER, { id: allotmentId, tenantId: TENANT, version: 1 });
    const a = await getAllotment();
    expect(a.status).toBe("waitlisted");
    expect(a.lastCommandErrorCode).toBe("INVALID_TRANSITION");
    expect(a.lastCommandErrorCommand).toBe("occupy");
  });

  it("a stale version is refused and recorded, and the quarter is NOT marked allotted", async () => {
    await deliver(COMMANDS.quarterAllot, OFFICER, { id: allotmentId, tenantId: TENANT, version: 99 });
    const a = await getAllotment();
    expect(a.status).toBe("waitlisted");
    expect(a.lastCommandErrorCode).toBe("ALLOTMENT_VERSION_CONFLICT");
    expect(await quarterStatus()).toBe("vacant");
  });

  it("a normal allot by a different officer applies and clears the stored refusal", async () => {
    await deliver(COMMANDS.quarterAllot, OFFICER, { id: allotmentId, tenantId: TENANT, version: 1 });
    const a = await getAllotment();
    expect(a.status).toBe("allotted");
    expect(a.version).toBe(2);
    expect(a.lastCommandErrorCode).toBeNull();
    expect(a.lastCommandErrorCommand).toBeNull();
    expect(a.lastCommandErrorAt).toBeNull();
    expect(await quarterStatus()).toBe("allotted");
  });
});
