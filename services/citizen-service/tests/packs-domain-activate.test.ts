/**
 * FN-17 / FN-20 — Domain Pack activation imports TL + PGR + Water as editable drafts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPacksConsumers } from "../src/modules/packs/consumer.js";
import { resolveActivationPackKeys, MUNICIPAL_ONBOARDING_PACK_KEYS } from "../src/modules/packs/domain.js";
import type { FastifyInstance } from "fastify";
import type { ServiceDefinitionRow } from "../src/modules/catalogue/schema.js";

registerPacksConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ADMIN = "00000000-0000-0000-0000-000000000099";

function tok(actor = ADMIN) {
  return signToken({ sub: actor, tid: TENANT, roles: ["citizen_admin", "super_admin"], sid: "sess-fn17" }, SECRET, 3600);
}
function hdr(t: string) {
  return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("waitFor timeout");
}

describe("resolveActivationPackKeys (unit)", () => {
  it("defaults municipal-in-v1 to TL + PGR + Water", () => {
    expect(resolveActivationPackKeys({
      domainPackKey: "municipal-in-v1",
      packKeys: [],
      manifest: {},
    })).toEqual([...MUNICIPAL_ONBOARDING_PACK_KEYS]);
  });

  it("honours manifest.pilotOrder", () => {
    expect(resolveActivationPackKeys({
      domainPackKey: "municipal-in-v1",
      packKeys: ["pack:fire-noc"],
      manifest: { pilotOrder: ["trade-license", "pgr", "water-connection"] },
    })).toEqual(["pack:trade-license", "pack:pgr", "pack:water-connection"]);
  });

  it("honours explicit packKeys request", () => {
    expect(resolveActivationPackKeys({
      domainPackKey: "municipal-in-v1",
      packKeys: [],
      manifest: {},
    }, ["pack:fire-noc"])).toEqual(["pack:fire-noc"]);
  });
});

describe("POST /v1/citizen/packs/domain/:key/activate (FN-17)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  it("activates municipal-in-v1 producing ≥3 editable drafts (TL, PGR, Water)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/packs/domain/municipal-in-v1/activate",
      headers: hdr(tok()),
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as {
      id: string;
      status: string;
      draftIds: string[];
      packKeys: string[];
      domainPackKey: string;
    };
    expect(body.status).toBe("accepted");
    expect(body.domainPackKey).toBe("municipal-in-v1");
    expect(body.draftIds.length).toBeGreaterThanOrEqual(3);
    expect(body.packKeys).toEqual(expect.arrayContaining([
      "pack:trade-license",
      "pack:pgr",
      "pack:water-connection",
    ]));

    // Same-session: projected drafts are readable immediately via cache-first catalogue GET.
    const immediate: ServiceDefinitionRow[] = [];
    for (const id of body.draftIds) {
      const g = await app.inject({
        method: "GET",
        url: `/v1/citizen/catalogue/services/${id}`,
        headers: hdr(tok()),
      });
      expect(g.statusCode).toBe(200);
      const def = g.json() as ServiceDefinitionRow;
      expect(def.status).toBe("draft");
      immediate.push(def);
    }
    const names = immediate.map((d) => d.name);
    expect(names.some((n) => /trade license/i.test(n))).toBe(true);
    expect(names.some((n) => /grievance|pgr/i.test(n))).toBe(true);
    expect(names.some((n) => /water/i.test(n))).toBe(true);

    // Consumer eventually persists durable catalogue rows (serviceKey no longer *-pending).
    for (const id of body.draftIds) {
      await waitFor(async () => {
        const g = await app.inject({
          method: "GET",
          url: `/v1/citizen/catalogue/services/${id}`,
          headers: hdr(tok()),
        });
        if (g.statusCode !== 200) return null;
        const def = g.json() as ServiceDefinitionRow;
        return def.serviceKey && !def.serviceKey.endsWith("-pending") ? def : null;
      }, 15_000);
    }
  }, 30_000);

  it("returns 404 for unknown domain pack", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/packs/domain/does-not-exist-v9/activate",
      headers: hdr(tok()),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/packs/domain/municipal-in-v1/activate",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
