/**
 * UAT W6 P1 (accept-nonexistent): call lifecycle commands (ring/miss/abandon and the
 * rest of the /calls/:id command family) used to publish and answer 202 for ANY
 * well-formed id. They now do a tenant-scoped read first: unknown / other-tenant
 * call → 404 and nothing is published; a real call still gets 202 + the command.
 *
 * UAT W6 P2: POST /v1/telephony/calls with an empty body used to queue a call with
 * no party at all; it now needs a party number.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { seedCall } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const CALL = randomUUID();

const headers = (tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["telephony_admin"], sid: "sess-w6b" }, SECRET, 3600)}`,
  "x-tenant-id": tid,
});

let app: FastifyInstance;
beforeAll(async () => {
  await seedCall(TENANT, CALL);
  app = await buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM telephony.calls WHERE tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

const verbs: Array<{ verb: string; topic: string; payload: unknown }> = [
  { verb: "ring", topic: COMMANDS.ringCall, payload: {} },
  { verb: "miss", topic: COMMANDS.missCall, payload: {} },
  { verb: "abandon", topic: COMMANDS.abandonCall, payload: {} },
  { verb: "answer", topic: COMMANDS.answerCall, payload: { agentId: randomUUID() } },
];

describe("UAT W6 P1 — call commands on non-existent ids", () => {
  for (const v of verbs) {
    it(`POST /v1/telephony/calls/:id/${v.verb}: random id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue("" as never);
      const res = await app.inject({ method: "POST", url: `/v1/telephony/calls/${randomUUID()}/${v.verb}`, headers: headers(), payload: v.payload as object });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
    it(`POST /v1/telephony/calls/:id/${v.verb}: another tenant's call → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue("" as never);
      const res = await app.inject({ method: "POST", url: `/v1/telephony/calls/${CALL}/${v.verb}`, headers: headers(OTHER_TENANT), payload: v.payload as object });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
    it(`POST /v1/telephony/calls/:id/${v.verb}: real call → 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue("" as never);
      const res = await app.inject({ method: "POST", url: `/v1/telephony/calls/${CALL}/${v.verb}`, headers: headers(), payload: v.payload as object });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe(v.topic);
    });
  }

  it("a command sent right after create (before the consumer wrote the row) still finds the call", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("" as never);
    const created = await app.inject({ method: "POST", url: "/v1/telephony/calls", headers: headers(), payload: { callerNumber: "+919876543210" } });
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;
    const ring = await app.inject({ method: "POST", url: `/v1/telephony/calls/${id}/ring`, headers: headers(), payload: {} });
    expect(ring.statusCode).toBe(202);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([COMMANDS.createCall, COMMANDS.ringCall]);
  });
});

describe("UAT W6 P2 — POST /v1/telephony/calls needs a party number", () => {
  it("empty body → 400, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("" as never);
    const res = await app.inject({ method: "POST", url: "/v1/telephony/calls", headers: headers(), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("outbound without calleeNumber → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/telephony/calls", headers: headers(), payload: { direction: "outbound", callerNumber: "+919876543210" } });
    expect(res.statusCode).toBe(400);
  });
  it("inbound with only the dialled number (withheld CLI) → 202", async () => {
    vi.spyOn(queue, "publish").mockResolvedValue("" as never);
    const res = await app.inject({ method: "POST", url: "/v1/telephony/calls", headers: headers(), payload: { direction: "inbound", calleeNumber: "+911234567890" } });
    expect(res.statusCode).toBe(202);
  });
});
