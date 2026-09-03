/**
 * Citizen Service — SLA-sweep scheduler live-DB RLS reproduction.
 *
 * modules/sla-sweep/scheduler.ts scans FOUR FORCE-ROW-LEVEL-SECURITY tables
 * (application.citizen_applications, grievance.citizen_grievances,
 * helpdesk.citizen_tickets, rti.citizen_rti_requests) ACROSS ALL TENANTS to
 * find overdue entities. Before migration 0028_sla_sweep_scanner_bypassrls.sql,
 * this went through Drizzle's `db` — bound to citizen_svc, the ordinary
 * NOBYPASSRLS service role — via a bare query with no app.tenant_id GUC set.
 * Under FORCE RLS that silently matched zero rows, no matter how many
 * entities were actually overdue: the sweep has never fired in production.
 *
 * This test seeds one genuinely-overdue row per table (through the normal
 * tenant-scoped write path, proving seeding itself is unaffected) and then
 * runs the real scheduler against the live test database. Before the fix
 * (scheduler.ts's bare `db.select()`), all four `expect(...).toContainEqual`
 * assertions below fail — the sweep publishes nothing for any of them. After
 * the fix (querying the citizen_scanner-owned SECURITY DEFINER functions),
 * all four fire.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { citizenApplications } from "../src/modules/application/schema.js";
import { citizenGrievances } from "../src/modules/grievance/schema.js";
import { citizenTickets } from "../src/modules/helpdesk/schema.js";
import { citizenRtiRequests } from "../src/modules/rti/schema.js";
import { runSlaSweep } from "../src/modules/sla-sweep/scheduler.js";
import { COMMANDS } from "../src/topics.js";
import type { Queue } from "@civitasone/queue";

const TENANT = "dd001111-1111-4000-8000-0000000d0101";
const ACTOR = "dd00aaaa-1111-4000-8000-0000000d010a";

const appId = randomUUID();
const grievanceId = randomUUID();
const ticketId = randomUUID();
const rtiId = randomUUID();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(citizenApplications).where(eq(citizenApplications.tenantId, TENANT));
    await tx.delete(citizenGrievances).where(eq(citizenGrievances.tenantId, TENANT));
    await tx.delete(citizenTickets).where(eq(citizenTickets.tenantId, TENANT));
    await tx.delete(citizenRtiRequests).where(eq(citizenRtiRequests.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  await cleanup();
  const now = new Date();
  const overdueDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const overdueDateStr = overdueDate.toISOString().slice(0, 10);

  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(citizenApplications).values({
      id: appId, tenantId: TENANT, citizenId: ACTOR, serviceId: randomUUID(),
      refNo: `SWEEP-${appId.slice(0, 8)}`, status: "submitted", deadline: overdueDateStr,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(citizenGrievances).values({
      id: grievanceId, tenantId: TENANT, citizenId: ACTOR,
      category: "sla-sweep-repro", subject: "SLA sweep repro", description: "seeded for sla-sweep-rls.test.ts",
      status: "registered", updatedAt: overdueDate, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(citizenTickets).values({
      id: ticketId, tenantId: TENANT, citizenId: ACTOR,
      subject: "SLA sweep repro", description: "seeded for sla-sweep-rls.test.ts",
      status: "open", slaDueAt: overdueDate, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(citizenRtiRequests).values({
      id: rtiId, tenantId: TENANT, citizenId: ACTOR, rtiNo: `RTI-${rtiId.slice(0, 8)}`,
      subject: "SLA sweep repro", description: "seeded for sla-sweep-rls.test.ts",
      cpioRef: randomUUID(), deadline: overdueDateStr, status: "filed",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("SLA sweep — cross-tenant FORCE RLS scan", () => {
  it("finds the genuinely-overdue rows this test just seeded (was always zero under the bare-query bug)", async () => {
    const published: Array<{ topic: string; payload: Record<string, unknown> }> = [];
    const fakeQueue = {
      publish: async (topic: string, envelope: { payload: Record<string, unknown> }) => {
        published.push({ topic, payload: envelope.payload });
      },
    } as unknown as Queue;

    await runSlaSweep(fakeQueue);

    expect(published).toContainEqual({
      topic: COMMANDS.applicationSlaCheck,
      payload: expect.objectContaining({ tenantId: TENANT, applicationId: appId }),
    });
    expect(published).toContainEqual({
      topic: COMMANDS.grievanceSlaCheck,
      payload: expect.objectContaining({ tenantId: TENANT, grievanceId }),
    });
    expect(published).toContainEqual({
      topic: COMMANDS.ticketSlaCheck,
      payload: expect.objectContaining({ tenantId: TENANT, ticketId }),
    });
    expect(published).toContainEqual({
      topic: COMMANDS.rtiSlaCheck,
      payload: expect.objectContaining({ tenantId: TENANT, rtiId }),
    });
  });
});
