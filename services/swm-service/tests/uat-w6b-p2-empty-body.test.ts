/**
 * UAT W6 P2 (empty-body accepted): every field of POST /v1/swm/field-tasks is
 * optional, so an EMPTY body used to queue a blank field task. A field task now
 * needs a route, a zone or at least one asset reference; nothing is published on 400.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { hdr } from "./support.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("UAT W6 P2 — POST /v1/swm/field-tasks", () => {
  it("empty body → 400, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({ method: "POST", url: "/v1/swm/field-tasks", headers: hdr(), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("only a date and assignee (no location) → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/swm/field-tasks", headers: hdr(),
      payload: { taskDate: "2026-11-15", assignedTo: "00000000-0000-4000-8000-0000000000aa" },
    });
    expect(res.statusCode).toBe(400);
  });
  it("an empty assetRefs array alone → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/swm/field-tasks", headers: hdr(), payload: { assetRefs: [] } });
    expect(res.statusCode).toBe(400);
  });
  for (const payload of [{ routeId: "route-7" }, { zoneId: "zone-3" }, { assetRefs: ["BIN-1"] }]) {
    it(`a located task ${JSON.stringify(payload)} → 202 and published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: "POST", url: "/v1/swm/field-tasks", headers: hdr(), payload });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  }
});
