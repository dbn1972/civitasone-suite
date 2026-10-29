/**
 * UAT W6 P2 (empty-body accepted): every field of POST /v1/sewerage/field-records
 * and POST /v1/sewerage/desludging is optional, so an EMPTY body used to queue a
 * blank field record / a desludging booking with no address, capacity, date or
 * slot. Both now need at least one describing field; nothing is published on 400.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ADMIN = randomUUID();
const adminAuth = {
  authorization: `Bearer ${signToken({ sub: ADMIN, tid: TENANT, roles: ["sewerage_admin"], sid: "sess-w6b" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("UAT W6 P2 — POST /v1/sewerage/field-records", () => {
  it("empty body → 400, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({ method: "POST", url: "/v1/sewerage/field-records", headers: adminAuth, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("a record with content (workPerformed) → 202 and published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({ method: "POST", url: "/v1/sewerage/field-records", headers: adminAuth, payload: { manholeRef: "MH-12", workPerformed: "Cleared" } });
    expect(res.statusCode).toBe(202);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("UAT W6 P2 — POST /v1/sewerage/desludging", () => {
  it("empty body → 400, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({ method: "POST", url: "/v1/sewerage/desludging", headers: adminAuth, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("feeMinor alone does not describe a booking → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/sewerage/desludging", headers: adminAuth, payload: { feeMinor: 5000 } });
    expect(res.statusCode).toBe(400);
  });
  it("an empty address object alone → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/sewerage/desludging", headers: adminAuth, payload: { address: {} } });
    expect(res.statusCode).toBe(400);
  });
  it("a real booking (address + date) → 202 and published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({
      method: "POST", url: "/v1/sewerage/desludging", headers: adminAuth,
      payload: { address: { line1: "12 Main Rd" }, requestedDate: "2026-11-15" },
    });
    expect(res.statusCode).toBe(202);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
