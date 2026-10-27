/**
 * GAP-LOCATIONS-INFRASTRUCTURE-06: an infrastructure asset can carry the id of its asset-register record,
 * so the register can link to /assets/:id. Real DB round trip; the link is optional and must be a UUID.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerInfrastructureConsumers } from "../src/modules/infrastructure/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const headers = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["location_admin"], sid: "s" }, SECRET, 3600)}`, "content-type": "application/json" };
const drain = () => (queue as unknown as MemoryQueue).drain();

let app: FastifyInstance;
beforeAll(async () => { registerInfrastructureConsumers(queue); app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const create = (payload: unknown) => app.inject({ method: "POST", url: "/v1/locations/infrastructure", headers, payload });
const read = async (id: string) => (await app.inject({ method: "GET", url: `/v1/locations/infrastructure/${id}`, headers })).json().data as { assetId: string | null; name: string };

describe("infrastructure asset link", () => {
  it("stores and returns the linked asset id", async () => {
    const assetId = randomUUID();
    const r = await create({ name: "Linked Bridge", type: "bridge", lat: 10, lng: 20, assetId });
    expect(r.statusCode).toBe(202);
    await drain();
    expect((await read(r.json().data.id)).assetId).toBe(assetId);
  });

  it("returns null for an asset with no link, and lists it that way", async () => {
    const r = await create({ name: "Unlinked Road", type: "road", lat: 11, lng: 21 });
    await drain();
    expect((await read(r.json().data.id)).assetId).toBeNull();
    const list = (await app.inject({ method: "GET", url: "/v1/locations/infrastructure", headers })).json().data as Array<{ name: string; assetId: string | null }>;
    expect(list.find((a) => a.name === "Unlinked Road")?.assetId).toBeNull();
  });

  it("rejects an asset id that is not a UUID", async () => {
    const r = await create({ name: "Bad Link", type: "road", lat: 1, lng: 2, assetId: "not-a-uuid" });
    expect(r.statusCode).toBe(400);
  });
});
