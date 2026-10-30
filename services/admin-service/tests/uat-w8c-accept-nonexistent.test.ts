/**
 * UAT W8-C (P1 accept-nonexistent): POST /v1/admin/custom-domains/:id/verify published the verify
 * command without reading the domain, so a random id got 202. It now does a tenant-scoped existence
 * read first: random id -> 404 and nothing published; a real domain -> 202 (the consumer still does
 * the fail-closed DNS proof).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { customDomains } from "../src/modules/custom-domains/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "8c000000-0000-4000-8000-0000000001a1";
const OTHER_TENANT = "8c000000-0000-4000-8000-0000000001b2";
const ACTOR = "8c000000-0000-4000-8000-0000000001c3";
const DOMAIN_ID = randomUUID();
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

const headers = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["super_admin"], sid: "s-w8c" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

async function outboxCount(): Promise<number> {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select({ id: outboxMessages.id }).from(outboxMessages)
    .where(eq(outboxMessages.tenantId, TENANT))));
  return rows.length;
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(customDomains).values({
    id: DOMAIN_ID, tenantId: TENANT, domain: `w8c-${DOMAIN_ID.slice(0, 8)}.example.test`, status: "pending_verification",
    verificationToken: "w8c-challenge", verificationMethod: "dns_txt", sslStatus: "pending",
    createdBy: ACTOR, updatedBy: ACTOR, version: 1,
  })));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(customDomains).where(eq(customDomains.id, DOMAIN_ID));
  })).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /v1/admin/custom-domains/:id/verify", () => {
  it("random id -> 404 and nothing published (empty and invalid-field bodies)", async () => {
    const spy = vi.spyOn(queue, "publish");
    const before = await outboxCount();
    for (const payload of [{}, INVALID_FIELDS]) {
      const res = await app.inject({ method: "POST", url: `/v1/admin/custom-domains/${randomUUID()}/verify`, headers: headers(), payload });
      expect(res.statusCode).toBe(404);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(await outboxCount()).toBe(before);
  });

  it("another tenant's domain -> 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/admin/custom-domains/${DOMAIN_ID}/verify`, headers: headers(OTHER_TENANT), payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it("the real domain -> 202", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/admin/custom-domains/${DOMAIN_ID}/verify`, headers: headers(), payload: {} });
    expect(res.statusCode).toBe(202);
  });
});
