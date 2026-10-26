/**
 * Role-feature revocation is a SOFT delete and the grant/revoke reason is persisted
 * (real DB, real Fastify, real consumers). Before: revoke hard-deleted the row (who /
 * when / why lost) and the reason the UI requires was dropped by the zod body.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";

const audits: Array<{ topic: string; payload: Record<string, unknown> }> = [];
vi.mock("../src/shared/outbox.js", async () => {
  const real = await vi.importActual<typeof import("../src/shared/outbox.js")>("../src/shared/outbox.js");
  return {
    ...real,
    enqueue: (async (tx: unknown, evt: { topic: string; payload: Record<string, unknown> }) => {
      audits.push({ topic: evt.topic, payload: evt.payload });
      return (real.enqueue as (...a: unknown[]) => Promise<unknown>)(tx, evt);
    }) as typeof real.enqueue,
  };
});

import { buildApp } from "../src/app.js";
import { sqlClient, readScoped } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerRoleFeatureConsumers } from "../src/modules/role-features/consumer.js";
import { roleFeatureGrants } from "../src/modules/role-features/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const ACTOR = randomUUID();
const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles: ["tenant_admin"], sid: "s-rf" }, SECRET, 3600)}`,
  "content-type": "application/json",
});
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();

let app: FastifyInstance;
beforeAll(async () => {
  registerRoleFeatureConsumers(queue);
  await queue.start();
  app = await buildApp();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function grant(roleName: string, featureKey: string, reason?: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(), payload: { roleName, featureKey, ...(reason ? { reason } : {}) } });
  expect(r.statusCode).toBe(202);
  await drain();
  return (r.json() as { id: string }).id;
}
const rowOf = (id: string) => readScoped(T, (tx) => tx.select().from(roleFeatureGrants).where(eq(roleFeatureGrants.id, id)));
const listIds = async () => ((await app.inject({ method: "GET", url: "/v1/policy/role-features", headers: hdr() })).json() as { data: Array<{ id: string }> }).data.map((g) => g.id);

describe("role-feature grant/revoke persistence", () => {
  it("persists the grant reason", async () => {
    const id = await grant("hr_clerk", "hrms.dashboard", "needed for onboarding");
    const [row] = await rowOf(id);
    expect(row?.reason).toBe("needed for onboarding");
    expect(row?.revokedAt).toBeNull();
  });

  it("rejects an over-long reason with 400", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(), payload: { roleName: "x", featureKey: "a.b", reason: "a".repeat(501) } });
    expect(r.statusCode).toBe(400);
  });

  it("revoke soft-deletes: row kept with revoked_at/by/reason, hidden from list + evaluate, audited with the reason", async () => {
    const id = await grant("hr_clerk", "hrms.reports", "initial");
    expect(await listIds()).toContain(id);
    audits.length = 0;
    const r = await app.inject({ method: "DELETE", url: `/v1/policy/role-features/${id}`, headers: hdr(), payload: { reason: "role no longer reviews reports" } });
    expect(r.statusCode).toBe(202);
    await drain();

    const [row] = await rowOf(id);
    expect(row).toBeDefined(); // NOT hard-deleted
    expect(row?.revokedAt).toBeInstanceOf(Date);
    expect(row?.revokedBy).toBe(ACTOR);
    expect(row?.revokeReason).toBe("role no longer reviews reports");

    expect(await listIds()).not.toContain(id);
    const byRole = await app.inject({ method: "GET", url: "/v1/policy/role-features/by-role/hr_clerk", headers: hdr() });
    expect((byRole.json() as { data: Array<{ id: string }> }).data.map((g) => g.id)).not.toContain(id);
    const ev = await app.inject({ method: "GET", url: "/v1/policy/role-features/evaluate?roles=hr_clerk", headers: hdr() });
    expect((ev.json() as { data: string[] }).data).not.toContain("hrms.reports");

    const audit = audits.find((a) => a.topic === "audit.event.record" && a.payload.action === "revoke");
    expect(audit?.payload).toMatchObject({ resourceId: id, outcome: "success", reason: "role no longer reviews reports" });
  });

  it("tenant_admin revoking an unknown grant is a synchronous 404", async () => {
    const r = await app.inject({ method: "DELETE", url: `/v1/policy/role-features/${randomUUID()}`, headers: hdr(), payload: { reason: "cleanup" } });
    expect(r.statusCode).toBe(404);
  });

  it("the consumer audits a revoke of an unknown / already-revoked grant as a failure and emits no revoked event", async () => {
    const id = await grant("hr_clerk", "hrms.settings", "grant for test");
    const send = async (grantId: string) => {
      const messageId = randomUUID();
      await queue.publish(COMMANDS.roleFeatureRevoke, {
        messageId, type: COMMANDS.roleFeatureRevoke, tenantId: T, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { grantId, tenantId: T, reason: "second revoke" },
      });
      await drain();
    };
    await send(id); // first revoke succeeds
    audits.length = 0;
    await send(id); // already revoked
    await send(randomUUID()); // unknown
    expect(audits.filter((a) => a.topic === "policy.role_feature.revoked")).toHaveLength(0);
    const failures = audits.filter((a) => a.topic === "audit.event.record" && a.payload.outcome === "failure");
    expect(failures).toHaveLength(2);
    expect(failures[0]?.payload).toMatchObject({ action: "revoke", code: "UNKNOWN_OR_ALREADY_REVOKED_GRANT", reason: "second revoke" });
  });

  it("a revoked grant can be granted again (new row, no unique clash)", async () => {
    const id = await grant("hr_clerk", "hrms.reports", "re-grant");
    expect(await listIds()).toContain(id);
  });
});
