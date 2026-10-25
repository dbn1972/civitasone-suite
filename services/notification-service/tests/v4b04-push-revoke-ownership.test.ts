/**
 * V4-B-04 — DELETE /v1/notification/push/subscriptions/:id must only revoke the
 * caller own subscription (admins may revoke any). A foreign or unknown id is a
 * 404, and the repo write is scoped by user_id as defence in depth.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { blindIndex } from "../src/shared/pii-crypto.js";
import { pushSubscriptions } from "../src/modules/push/schema.js";
import * as repo from "../src/modules/push/repo.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = globalThis.crypto.randomUUID();
const OWNER = globalThis.crypto.randomUUID();
const ATTACKER = globalThis.crypto.randomUUID();
const ADMIN = globalThis.crypto.randomUUID();
const SUB_ID = globalThis.crypto.randomUUID();
const DEVICE = "fcm-device-token-v4b04-abcdefgh";

const bearer = (roles: string[], sub: string) =>
  ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-v4b04" }, SECRET, 3600)}` });

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
}

async function seed(): Promise<void> {
  await cleanup();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(pushSubscriptions).values({
      id: SUB_ID, tenantId: TENANT, userId: OWNER, platform: "android",
      deviceToken: DEVICE, tokenHash: blindIndex(DEVICE),
      enabled: true, createdBy: OWNER, updatedBy: OWNER, version: 1,
    });
  }));
}

async function del(id: string, roles: string[], sub: string) {
  const app = await buildApp();
  const res = await app.inject({
    method: "DELETE", url: `/v1/notification/push/subscriptions/${id}`, headers: bearer(roles, sub),
  });
  await app.close();
  return res;
}

beforeAll(seed);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("V4-B-04 push subscription revoke ownership", () => {
  it("404 when a citizen revokes another user subscription", async () => {
    const res = await del(SUB_ID, ["citizen"], ATTACKER);
    expect(res.statusCode).toBe(404);
  });

  it("404 for a non-existent subscription id", async () => {
    const res = await del(globalThis.crypto.randomUUID(), ["employee"], OWNER);
    expect(res.statusCode).toBe(404);
  });

  it("202 for the owner", async () => {
    const res = await del(SUB_ID, ["citizen"], OWNER);
    expect(res.statusCode).toBe(202);
  });

  it("202 for an admin revoking someone else subscription", async () => {
    const res = await del(SUB_ID, ["notification_admin"], ADMIN);
    expect(res.statusCode).toBe(202);
  });

  it("repo write is scoped by user_id: wrong owner revokes nothing", async () => {
    await seed();
    const revoked = await runWithTenant(TENANT, () => db.transaction((tx) =>
      repo.revokeSubscription(tx, TENANT, SUB_ID, ATTACKER, ATTACKER)));
    expect(revoked).toBe(false);
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, SUB_ID))));
    expect(rows[0]?.enabled).toBe(true);
    const ok = await runWithTenant(TENANT, () => db.transaction((tx) =>
      repo.revokeSubscription(tx, TENANT, SUB_ID, OWNER, OWNER)));
    expect(ok).toBe(true);
  });
});
