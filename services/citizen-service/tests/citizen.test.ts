/**
 * citizen-service test suite
 *
 * 1. RTI deadline: consumer sets deadline = today + 30 days
 * 2. SLA breach: application older than sla_config.max_days → event emitted
 * 3. Grievance state machine: registered → assigned → in_progress → resolved
 * 4. CQRS: POST /citizen/grievances → queue → consumer → DB (MemoryQueue + MemoryCache)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { citizenRtiRequests } from "../src/modules/rti/schema.js";
import { citizenApplications } from "../src/modules/application/schema.js";
import { citizenGrievances, citizenGrievanceActions } from "../src/modules/grievance/schema.js";
import { citizenSlaConfigs } from "../src/modules/analytics/schema.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerGrievanceConsumers } from "../src/modules/grievance/consumer.js";
import { computeRtiDeadline } from "../src/modules/rti/domain.js";
import { isSlaBreached } from "../src/modules/application/domain.js";
import { assertGrievanceTransition } from "../src/modules/grievance/domain.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000001";
const TENANT = "11111111-aaaa-4000-8000-000000000002";
const CITIZEN = "22222222-bbbb-4000-8000-000000000001";
const RTI_1  = "aaaaaaaa-dddd-4000-8000-000000000001";
const MSG_RTI_1 = "bbbbbbbb-eeee-4000-8000-000000000001";
const APP_1  = "cccccccc-ffff-4000-8000-000000000001";
const MSG_APP_1 = "dddddddd-aaaa-4000-8000-000000000001";
const MSG_SLA_1 = "eeeeeeee-bbbb-4000-8000-000000000001";
const SLA_CFG = "ffffffff-cccc-4000-8000-000000000001";
const GRIEV_1 = "11111111-dddd-4000-8000-000000000001";
const MSG_GRIEV_1 = "22222222-eeee-4000-8000-000000000002";
const MSG_ASSIGN = "33333333-ffff-4000-8000-000000000003";
const MSG_ACTION = "44444444-aaaa-4000-8000-000000000004";
const MSG_RESOLVE = "55555555-bbbb-4000-8000-000000000005";
const OFFICER = "66666666-cccc-4000-8000-000000000006";

// citizen domain tables and _outbox.messages have FORCED RLS (policy:
// tenant_id = current_tenant_id()). Direct DB access from a test must run with
// the app.tenant_id GUC set — wrap in runWithTenant + db.transaction so
// wrapWithTenantGuc injects it (same pattern as telephony-service tests).
function asTenant<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

async function wipe() {
  await asTenant(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(citizenGrievanceActions).where(eq(citizenGrievanceActions.tenantId, TENANT));
    await tx.delete(citizenGrievances).where(eq(citizenGrievances.tenantId, TENANT));
    await tx.delete(citizenApplications).where(eq(citizenApplications.tenantId, TENANT));
    await tx.delete(citizenRtiRequests).where(eq(citizenRtiRequests.tenantId, TENANT));
    await tx.delete(citizenSlaConfigs).where(eq(citizenSlaConfigs.tenantId, TENANT));
    for (const id of [MSG_RTI_1, MSG_APP_1, MSG_SLA_1, MSG_GRIEV_1, MSG_ASSIGN, MSG_ACTION, MSG_RESOLVE]) {
      await tx.delete(processed).where(eq(processed.messageId, id));
    }
  });
}

// ── 1. RTI deadline — pure ────────────────────────────────────────────────

describe("RTI domain — deadline computation (pure)", () => {
  it("deadline is exactly 30 days after createdAt", () => {
    const created  = new Date("2026-01-01T00:00:00.000Z");
    const deadline = computeRtiDeadline(created);
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-01-31");
  });
});

describe("RTI CQRS — file wiring (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("citizen.rti.file → consumer → DB row with 30-day deadline", async () => {
    const q = new MemoryQueue();
    registerRtiConsumers(q);
    await q.start();

    await q.publish(COMMANDS.rtiFile, {
      messageId: MSG_RTI_1,
      type: COMMANDS.rtiFile,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-rti-1", schemaVersion: "1.0",
      payload: {
        id: RTI_1, tenantId: TENANT, rtiNo: "RTI/2026/001",
        subject: "Road info", description: "Details please",
        cpioRef: ACTOR, citizenId: CITIZEN,
      },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await asTenant((tx) => tx.select().from(citizenRtiRequests).where(eq(citizenRtiRequests.id, RTI_1)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("filed");

    const deadline = new Date(rows[0]?.deadline ?? "");
    const now = new Date();
    const diff = Math.round((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    expect(diff).toBeGreaterThanOrEqual(29);
    expect(diff).toBeLessThanOrEqual(30);

    const outbox = await asTenant((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.rtiFiled);
  });
});

// ── 2. SLA breach ─────────────────────────────────────────────────────────

describe("Application domain — SLA breach (pure)", () => {
  it("application older than max_days and not resolved is breached", () => {
    const created = new Date();
    created.setDate(created.getDate() - 31);
    expect(isSlaBreached(created, 30, "submitted")).toBe(true);
    expect(isSlaBreached(created, 30, "approved")).toBe(false);
  });
});

describe("Application CQRS — SLA breach event (integration)", () => {
  beforeAll(async () => {
    await wipe();
    await asTenant((tx) => tx.insert(citizenSlaConfigs).values({
      id: SLA_CFG, tenantId: TENANT, serviceType: "certificate", maxDays: 7,
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const old = new Date();
    old.setDate(old.getDate() - 10);
    await asTenant((tx) => tx.insert(citizenApplications).values({
      id: APP_1, tenantId: TENANT, citizenId: CITIZEN,
      serviceId: "99999999-9999-4000-8000-000000000099",
      refNo: "APP-TEST-001", status: "submitted",
      submittedAt: old, createdAt: old, updatedAt: old,
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
  });
  afterAll(async () => { await wipe(); });

  it("sla_check consumer emits citizen.application.sla_breached", async () => {
    const q = new MemoryQueue();
    registerApplicationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.applicationSlaCheck, {
      messageId: MSG_SLA_1,
      type: COMMANDS.applicationSlaCheck,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-sla-1", schemaVersion: "1.0",
      payload: { tenantId: TENANT, applicationId: APP_1, serviceType: "certificate", maxDays: 7 },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const outbox = await asTenant((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.applicationSlaBreached);
  });
});

// ── 3. Grievance state machine ────────────────────────────────────────────

describe("Grievance domain — state machine (pure)", () => {
  it("registered → assigned → in_progress → resolved", () => {
    expect(() => assertGrievanceTransition("registered", "assigned")).not.toThrow();
    expect(() => assertGrievanceTransition("assigned", "in_progress")).not.toThrow();
    expect(() => assertGrievanceTransition("in_progress", "resolved")).not.toThrow();
    expect(() => assertGrievanceTransition("registered", "resolved")).toThrow(/INVALID_TRANSITION/);
  });
});

// ── 4. CQRS grievance integration ─────────────────────────────────────────

describe("Grievance CQRS — register → assign → action → resolve", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  it("citizen.grievance.register → consumer → DB; full lifecycle via queue", async () => {
    const q = new MemoryQueue();
    registerGrievanceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.grievanceRegister, {
      messageId: MSG_GRIEV_1,
      type: COMMANDS.grievanceRegister,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-g-1", schemaVersion: "1.0",
      payload: {
        id: GRIEV_1, tenantId: TENANT, citizenId: CITIZEN,
        category: "water supply", subject: "No water", description: "No water for 3 days",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 500));

    let rows = await asTenant((tx) => tx.select().from(citizenGrievances).where(eq(citizenGrievances.id, GRIEV_1)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("assigned");
    expect(rows[0]?.priority).toBe("high");
    expect(rows[0]?.departmentRef).toBe("dept:water");

    await q.publish(COMMANDS.grievanceAction, {
      messageId: MSG_ACTION,
      type: COMMANDS.grievanceAction,
      tenantId: TENANT, actorId: OFFICER, correlationId: "corr-g-3", schemaVersion: "1.0",
      payload: {
        id: "77777777-aaaa-4000-8000-000000000007",
        grievanceId: GRIEV_1, tenantId: TENANT,
        actionType: "investigate", note: "Team dispatched", status: "in_progress",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 500));

    rows = await asTenant((tx) => tx.select().from(citizenGrievances).where(eq(citizenGrievances.id, GRIEV_1)));
    expect(rows[0]?.status).toBe("in_progress");

    await q.publish(COMMANDS.grievanceResolve, {
      messageId: MSG_RESOLVE,
      type: COMMANDS.grievanceResolve,
      tenantId: TENANT, actorId: OFFICER, correlationId: "corr-g-4", schemaVersion: "1.0",
      payload: { id: GRIEV_1, tenantId: TENANT, note: "Water restored" },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    rows = await asTenant((tx) => tx.select().from(citizenGrievances).where(eq(citizenGrievances.id, GRIEV_1)));
    expect(rows[0]?.status).toBe("resolved");

    const actions = await asTenant((tx) => tx.select().from(citizenGrievanceActions).where(eq(citizenGrievanceActions.grievanceId, GRIEV_1)));
    expect(actions.length).toBeGreaterThanOrEqual(3);

    const outbox = await asTenant((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.grievanceResolved);
  });
});
