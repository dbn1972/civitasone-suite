/**
 * CLOS3-S1-11 -- DB-backed: PUT /v1/revenue/rate-heads/:id/slabs replaces the
 * live slab set atomically and effective-dated; editing never duplicates.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRateEngineConsumers } from "../src/modules/rate-engine/consumer.js";

registerRateEngineConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const TENANT = randomUUID();
const USER = randomUUID();
const hdr = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s-clos3-s1-11" }, SECRET, 3600)}`,
  "content-type": "application/json",
  "x-tenant-id": TENANT,
});
const ADMIN = hdr(["revenue_admin"]);

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

type Slab = { id: string; slabType: string; rateValue: string | number; effectiveFrom: string; effectiveTo: string | null; isActive: boolean };

describe("CLOS3-S1-11 rate slab replace-set", () => {
  let app: FastifyInstance;
  let headId = "";
  beforeAll(async () => {
    app = await buildApp();
    const code = `s111-${Date.now().toString(36)}`;
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/rate-heads", headers: ADMIN,
      payload: { code, name: "Fee rate", category: "service_fee" },
    });
    expect(res.statusCode).toBe(202);
    const head = await waitFor(async () => {
      const l = await app.inject({ method: "GET", url: "/v1/revenue/rate-heads", headers: ADMIN });
      return (l.json().data as { id: string; code: string }[]).find((h) => h.code === code);
    });
    headId = head.id;
    // The 202 body carries the head id so callers can address it (PUT its slabs) without a read-back.
    expect(res.json().data.id).toBe(headId);
  });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  const slabs = async (): Promise<Slab[]> => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/rate-slabs?rateHeadId=${headId}`, headers: ADMIN });
    return res.json().data as Slab[];
  };
  const put = (effectiveFrom: string, set: unknown[]) =>
    app.inject({ method: "PUT", url: `/v1/revenue/rate-heads/${headId}/slabs`, headers: ADMIN, payload: { effectiveFrom, slabs: set } });

  it("first save inserts, identical re-save is a no-op, an edit supersedes (no duplicate live slab)", async () => {
    const set1 = [{ slabType: "flat", rateValue: "10000" }];
    expect((await put("2026-04-01", set1)).statusCode).toBe(202);
    await waitFor(async () => (await slabs()).length === 1);

    // Same set again (what the autosave used to do every 2s): nothing new.
    expect((await put("2026-04-01", set1)).statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 250));
    expect(await slabs()).toHaveLength(1);

    // Edit: old slab end-dated at the new effectiveFrom, new one is the only live slab from then.
    expect((await put("2026-10-25", [{ slabType: "flat", rateValue: "15000" }])).statusCode).toBe(202);
    await waitFor(async () => (await slabs()).length === 2);
    const rows = await slabs();
    const old = rows.find((r) => String(r.rateValue) === "10000")!;
    const next = rows.find((r) => String(r.rateValue) === "15000")!;
    expect(String(old.effectiveTo).slice(0, 10)).toBe("2026-10-25");
    expect(next.effectiveTo).toBeNull();
    expect(rows.filter((r) => r.isActive && r.effectiveTo === null)).toHaveLength(1);
  });

  it("a set that fails validation mid-way leaves the live set untouched (atomic)", async () => {
    const before = await slabs();
    const bad = await put("2027-01-01", [
      { slabType: "band", bandFrom: "0", bandTo: "1000", rateValue: "10" },
      { slabType: "band", bandFrom: "500", bandTo: "2000", rateValue: "20" },
    ]);
    expect(bad.statusCode).toBe(202); // async: accepted, rejected by the consumer
    await new Promise((r) => setTimeout(r, 300));
    const after = await slabs();
    expect(after).toHaveLength(before.length);
    expect(after.filter((r) => r.isActive && r.effectiveTo === null).map((r) => r.id)).toEqual(
      before.filter((r) => r.isActive && r.effectiveTo === null).map((r) => r.id),
    );
  });

  it("is role-gated and validates input", async () => {
    const id = headId;
    const deny = await app.inject({
      method: "PUT", url: `/v1/revenue/rate-heads/${id}/slabs`, headers: hdr(["employee"]),
      payload: { effectiveFrom: "2026-10-25", slabs: [{ slabType: "flat", rateValue: "1" }] },
    });
    expect(deny.statusCode).toBe(403);
    expect((await put("2026-10-25", [])).statusCode).toBe(400);
    expect((await put("not-a-date", [{ slabType: "flat", rateValue: "1" }])).statusCode).toBe(400);
    const noAuth = await app.inject({ method: "PUT", url: `/v1/revenue/rate-heads/${id}/slabs`, payload: {} });
    expect(noAuth.statusCode).toBe(401);
  });
});
