/**
 * UAT W6-A (P1 accept-nonexistent): PATCH /v1/inventory/srn/:id/sign published without
 * reading the SRN, so a random id got 202. It now does a tenant-scoped read first.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { storeReceiptNotes } from "../src/modules/srn/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const SRN = randomUUID();

const hdr = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["store_officer", "inventory_admin", "super_admin"], sid: "s" }, SECRET, 3600)}`,
  // The gateway sets x-tenant-id; createTenantTxHook reads it to scope db.transaction() reads.
  "x-tenant-id": tenant,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.insert(storeReceiptNotes).values({ id: SRN, tenantId: TENANT, grnId: randomUUID(), storeOfficerId: ACTOR })));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(storeReceiptNotes).where(eq(storeReceiptNotes.id, SRN)))).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("UAT W6-A: PATCH /v1/inventory/srn/:id/sign", () => {
  it("random id -> 404, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await app.inject({ method: "PATCH", url: `/v1/inventory/srn/${randomUUID()}/sign`, headers: hdr(), payload: {} });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("another tenant's SRN -> 404, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await app.inject({ method: "PATCH", url: `/v1/inventory/srn/${SRN}/sign`, headers: hdr(OTHER_TENANT), payload: {} });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("real SRN -> 202 and the sign command is published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const res = await app.inject({ method: "PATCH", url: `/v1/inventory/srn/${SRN}/sign`, headers: hdr(), payload: { remarks: "w6a" } });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
    } finally {
      spy.mockRestore();
    }
  });
});
