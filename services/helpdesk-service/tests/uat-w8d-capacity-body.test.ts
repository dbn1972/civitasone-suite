/**
 * UAT W8-D: PATCH /v1/helpdesk/routing/agents/:agentId/capacity is an upsert keyed by an
 * identity user id (the first call creates the agent's capacity row), so a never-seen agentId
 * is legitimate and there is no local record to 404 on. What was wrong is the body: every field
 * was optional, so an empty body (or one carrying only unknown keys, which zod strips) still
 * published an upsert that created a default row. At least one field is now required.
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
const headers = () => ({
  authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles: ["helpdesk_admin"], sid: "sess-w8d-hd" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
});
const patch = (payload: unknown) =>
  app.inject({ method: "PATCH", url: `/v1/helpdesk/routing/agents/${randomUUID()}/capacity`, headers: headers(), payload: payload as object });

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("UAT W8-D: PATCH routing/agents/:agentId/capacity needs at least one capacity field", () => {
  it("empty body -> 400, nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await patch({});
    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("only unknown fields (stripped by zod) -> 400, nothing published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await patch({ id: randomUUID(), amount: 5, email: "a@b.c" });
    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("an out-of-range field is still refused -> 400", async () => {
    const res = await patch({ maxTickets: 0 });
    expect(res.statusCode).toBe(400);
  });

  it("one real field (first-time upsert for a new agent) -> 202 and the upsert is published", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await patch({ available: false });
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
