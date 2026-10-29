/**
 * UAT DB-test defects (g2 #8, #9, #29): RTI transfer target validation,
 * grievance assign on a freshly registered grievance, and optimistic-lock
 * version bumps on citizen portal / application updates.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import { registerGrievanceConsumers } from "../src/modules/grievance/consumer.js";
import { assertGrievanceAssignable, assertGrievanceTransition } from "../src/modules/grievance/domain.js";
import { citizenGrievances } from "../src/modules/grievance/schema.js";
import { COMMANDS } from "../src/topics.js";
import * as portalRepo from "../src/modules/portal/repo.js";
import * as appRepo from "../src/modules/application/repo.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";

registerRtiConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OFFICER = randomUUID();
const CITIZEN = randomUUID();
const CPIO_FROM = randomUUID();
const CPIO_TO = randomUUID();
const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: OFFICER, tid: TENANT, roles: ["citizen_officer"], sid: "s" }, SECRET, 3600)}`,
  "content-type": "application/json", "x-tenant-id": TENANT,
});

let app: FastifyInstance;
let rtiId = "";

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

beforeAll(async () => {
  app = await buildApp();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO rti.cpio_directory (id, tenant_id, name, public_authority, created_by, updated_by)
              VALUES (${CPIO_TO}, ${TENANT}, 'B. Rao', 'Roads Department', ${OFFICER}, ${OFFICER})`;
  });
  const r = await app.inject({
    method: "POST", url: "/v1/citizen/rti", headers: hdr(),
    payload: { citizenId: CITIZEN, subject: "info", description: "please provide records", cpioRef: CPIO_FROM },
  });
  expect(r.statusCode).toBe(202);
  rtiId = r.json().id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/citizen/rti/${rtiId}`, headers: hdr() })).statusCode === 200);
}, 30000);

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM rti.citizen_rti_transfers WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM rti.citizen_rti_requests WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM rti.cpio_directory WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM grievance.citizen_grievances WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("UAT #8 — RTI transfer validates toAuthority at the route", () => {
  const post = (toAuthority: unknown) =>
    app.inject({ method: "POST", url: `/v1/citizen/rti/${rtiId}/transfer`, headers: hdr(), payload: { toAuthority } });

  it("free text is rejected 422, not accepted then dead-lettered", async () => {
    expect((await post("Under Secretary, Ministry of Roads")).statusCode).toBe(422);
  });

  it("a well-formed uuid that is not in the CPIO directory is rejected 422", async () => {
    expect((await post(randomUUID())).statusCode).toBe(422);
  });

  it("a directory id is accepted 202 and the transfer is applied", async () => {
    const res = await post(CPIO_TO);
    expect(res.statusCode).toBe(202);
    const row = await waitFor(async () => {
      const d = (await app.inject({ method: "GET", url: `/v1/citizen/rti/${rtiId}`, headers: hdr() })).json();
      return d.status === "transferred" ? d : null;
    });
    expect(row.cpioRef).toBe(CPIO_TO);
  });
});

describe("UAT #9 — grievance assign on a freshly registered grievance", () => {
  const GID = randomUUID();
  const NEW_ASSIGNEE = randomUUID();
  const msgIds: string[] = [];

  async function deliver(topic: string, payload: Record<string, unknown>) {
    const messageId = randomUUID();
    msgIds.push(messageId);
    const q = new MemoryQueue();
    registerGrievanceConsumers(q);
    await q.start();
    await q.publish(topic, {
      messageId, type: topic, tenantId: TENANT, actorId: OFFICER,
      correlationId: `c-${messageId}`, schemaVersion: "1.0", payload,
    });
    await q.drain();
    await q.stop();
  }

  afterAll(async () => {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    for (const id of msgIds) await db.delete(processed).where(eq(processed.messageId, id));
  });

  it("re-assigns a new (auto-assigned) grievance instead of dropping the command", async () => {
    await deliver(COMMANDS.grievanceRegister, {
      id: GID, tenantId: TENANT, citizenId: CITIZEN, category: "Water Supply",
      subject: "No water", description: "No water for three days in ward five",
    });
    await deliver(COMMANDS.grievanceAssign, { id: GID, tenantId: TENANT, assignedTo: NEW_ASSIGNEE, departmentRef: "dept:power" });
    const g = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      (await tx.select().from(citizenGrievances).where(eq(citizenGrievances.id, GID)))[0]));
    expect(g?.assignedTo).toBe(NEW_ASSIGNEE);
    expect(g?.departmentRef).toBe("dept:power");
    expect(g?.status).toBe("assigned");
  });

  it("assertGrievanceAssignable allows assigned->assigned but keeps the lifecycle strict", () => {
    expect(() => assertGrievanceAssignable("assigned")).not.toThrow();
    expect(() => assertGrievanceAssignable("registered")).not.toThrow();
    expect(() => assertGrievanceAssignable("reopened")).not.toThrow();
    expect(() => assertGrievanceAssignable("closed")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertGrievanceAssignable("resolved")).toThrow(/INVALID_TRANSITION/);
    // The state machine itself still refuses self-transitions.
    expect(() => assertGrievanceTransition("assigned", "assigned")).toThrow(/INVALID_TRANSITION/);
  });
});

describe("UAT #29 — citizen portal/application updates bump version", () => {
  it("updateProfile and updateApplication increment version", async () => {
    const profileId = randomUUID();
    const appId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await portalRepo.insertProfile(tx, { id: profileId, tenantId: TENANT, name: "Asha", createdBy: OFFICER, updatedBy: OFFICER });
      await appRepo.insertApplication(tx, {
        id: appId, tenantId: TENANT, citizenId: profileId, serviceId: randomUUID(), refNo: `R-${appId.slice(0, 8)}`,
        createdBy: OFFICER, updatedBy: OFFICER,
      });
    }));
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await portalRepo.updateProfile(tx, profileId, TENANT, { ward: "W-9", updatedBy: OFFICER });
      await portalRepo.updateProfile(tx, profileId, TENANT, { ward: "W-10", updatedBy: OFFICER });
      await appRepo.updateApplication(tx, appId, TENANT, { status: "under_review", updatedBy: OFFICER });
    }));
    const [p, a] = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      const p = await sql`SELECT version FROM portal.citizen_profiles WHERE id = ${profileId}`;
      const a = await sql`SELECT version FROM application.citizen_applications WHERE id = ${appId}`;
      await sql`DELETE FROM portal.citizen_profiles WHERE id = ${profileId}`;
      await sql`DELETE FROM application.citizen_applications WHERE id = ${appId}`;
      return [p, a];
    });
    expect(p[0]?.version).toBe(3);
    expect(a[0]?.version).toBe(2);
  });
});
