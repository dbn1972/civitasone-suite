/**
 * GAP-DESIGNER-DETAIL-B8-01 — the catalogue persists notification templates in
 * ARBITRARY locales (not just en/hi), proving the designer's dynamic locale
 * tabs are backed end-to-end.
 *
 * The notification config lives in `service_definitions.outputs` (opaque jsonb,
 * validated as z.array(z.unknown())), and the service's publish locales live in
 * `locales` (BCP-47 tags). This test creates a service with locales ['en','or']
 * and a notification binding whose body carries an Odia ('or') string, then
 * reads it back and asserts the arbitrary locale key survived the round trip
 * unchanged. It also confirms the FN-08 runtime extractor (which keys off
 * event/channel/templateId, not body locales) still recognises the binding.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerCatalogueConsumers } from "../src/modules/catalogue/consumer.js";
import { extractNotificationBindings } from "../src/modules/catalogue/notification-bindings.js";
import type { FastifyInstance } from "fastify";

registerCatalogueConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = "c1c1c1c1-0000-4000-8000-0000000000b8";
const MAKER = "d1d1d1d1-0000-4000-8000-0000000000b8";

function tok(roles = ["citizen_admin", "citizen_officer", "super_admin"]) {
  return signToken({ sub: MAKER, tid: TENANT, roles, sid: "sess-b8-locale" }, SECRET, 3600);
}
function hdr() {
  return { authorization: `Bearer ${tok()}`, "content-type": "application/json", "x-tenant-id": TENANT };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GAP-DESIGNER-DETAIL-B8-01 catalogue dynamic-locale notification templates", () => {
  const SERVICE_KEY = `b8-locale-${Date.now().toString(36)}`;

  // The Odia (or) body — an arbitrary locale key outside the hard-coded en/hi.
  const OR_BODY = "ଆପଣଙ୍କ ଆବେଦନ {{app_no}} ଗ୍ରହଣ କରାଯାଇଛି।";
  const NOTIF_OUTPUT = {
    kind: "notifications",
    bindings: [
      {
        event: "submitted",
        channel: "sms",
        templateId: "aaaaaaaa-0b8b-4000-8000-00000000b801",
        templateName: "Application submitted · SMS",
        enabled: true,
        // Arbitrary locales: en + or (Odia), NO hi.
        body: { en: "Your application {{app_no}} was received.", or: OR_BODY },
        subject: { en: "", or: "" },
      },
    ],
  };

  let defId: string;

  it("creates a service in locales ['en','or'] with an Odia notification body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/catalogue/services", headers: hdr(),
      payload: {
        serviceKey: SERVICE_KEY,
        name: "Odia pilot service",
        servicePattern: "certificate",
        channels: ["portal"],
        requiredDocuments: [],
        locales: ["en", "or"],
        outputs: [NOTIF_OUTPUT],
      },
    });
    expect(res.statusCode).toBe(202);
    defId = res.json().id;

    const def = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr() });
      return g.statusCode === 200 ? g.json() : null;
    });

    // The service's publish locales round-tripped (arbitrary BCP-47 tag 'or').
    expect(def.locales).toEqual(["en", "or"]);
  });

  it("round-trips the arbitrary 'or' locale key in the notification body unchanged", async () => {
    const g = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr() });
    expect(g.statusCode).toBe(200);
    const outputs = g.json().outputs as Array<{ kind?: string; bindings?: Array<{ body?: Record<string, string> }> }>;
    const notif = outputs.find((o) => o.kind === "notifications");
    expect(notif).toBeDefined();
    const body = notif!.bindings![0]!.body!;
    // The Odia key and value survived — not coerced to en/hi, not dropped.
    expect(body.or).toBe(OR_BODY);
    expect(body.en).toContain("was received");
    expect("hi" in body).toBe(false);
  });

  it("the FN-08 runtime extractor still recognises the binding (keys off event/channel/templateId, not body locale)", async () => {
    const g = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr() });
    const bindings = extractNotificationBindings(g.json().outputs as unknown[]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.event).toBe("submitted");
    expect(bindings[0]!.channel).toBe("sms");
    expect(bindings[0]!.templateId).toBe("aaaaaaaa-0b8b-4000-8000-00000000b801");
  });

  it("PATCH can add a THIRD arbitrary locale ('bn') and it round-trips too", async () => {
    const BN_BODY = "আপনার আবেদন {{app_no}} গৃহীত হয়েছে।";
    const patched = {
      ...NOTIF_OUTPUT,
      bindings: [{ ...NOTIF_OUTPUT.bindings[0], body: { ...NOTIF_OUTPUT.bindings[0]!.body, bn: BN_BODY } }],
    };
    const res = await app.inject({
      method: "PATCH", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr(),
      payload: { locales: ["en", "or", "bn"], outputs: [patched] },
    });
    expect(res.statusCode).toBe(202);

    const def = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr() });
      const o = (g.json().outputs as Array<{ kind?: string; bindings?: Array<{ body?: Record<string, string> }> }>)
        .find((x) => x.kind === "notifications");
      return o?.bindings?.[0]?.body?.bn ? g.json() : null;
    });
    const outputs = def.outputs as Array<{ kind?: string; bindings?: Array<{ body?: Record<string, string> }> }>;
    const body = outputs.find((o) => o.kind === "notifications")!.bindings![0]!.body!;
    expect(body.bn).toBe(BN_BODY);
    expect(body.or).toBe(OR_BODY);
    expect(def.locales).toEqual(["en", "or", "bn"]);
  });
});
