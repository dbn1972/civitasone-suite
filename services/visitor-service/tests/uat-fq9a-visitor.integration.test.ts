/**
 * UAT FQ9-A visitor-service defects, driven against a real Postgres (runner-fq9.md):
 *
 *  #31 SECURITY  raw device bearer token persisted in `_outbox.messages` (visitor.device.registered /
 *                credential_rotated payload.token)
 *  #27           PATCH /devices/:id name/capabilities never applied (landed in pending_config)
 *  #28           POST /recurring-passes never created a row (recurring_passes_pass_id_fkey)
 *  #29           GET /blacklist 500 when ONE row's person_name cannot be decrypted
 *  #32           PATCH /badges/templates/:id inserted a new row; rollback 422 NO_PREVIOUS_VERSION
 *  #37           POST /devices/heartbeat 500 `invalid input syntax for type uuid: ""`
 *  #8            check-in / device register with an unknown gate: 202 then silent dead-letter
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient, scopedRead } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { COMMANDS } from "../src/topics.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { devices } from "../src/modules/device-registry/schema.js";
import { badgeTemplates } from "../src/modules/badge-print/schema.js";
import { recurringPasses } from "../src/modules/recurring-pass/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { blacklistEntries } from "../src/modules/blacklist/schema.js";
import { registerDeviceRegistryConsumers } from "../src/modules/device-registry/consumer.js";
import { registerBadgePrintConsumers } from "../src/modules/badge-print/consumer.js";
import { registerRecurringPassConsumers } from "../src/modules/recurring-pass/consumer.js";
import { listBlacklistEntries, UNDECRYPTABLE_PII_PLACEHOLDER } from "../src/modules/blacklist/repo.js";
import { blindIndex } from "../src/shared/pii-crypto.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const LOCATION = randomUUID();
const GATE = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

function adminHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["security_admin", "facility_admin"], sid: "sess-fq9a" }, SECRET, 3600)}`,
    "content-type": "application/json",
  };
}

/** MemoryQueue whose handlers run under the message tenant, exactly like worker.ts. */
function tenantQueue(register: (q: MemoryQueue) => void): MemoryQueue {
  const queue = new MemoryQueue();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>, opts?: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)), opts);
  register(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, messageId?: string, waitMs = 600): Promise<void> {
  await queue.publish(topic, {
    ...(messageId ? { messageId } : {}),
    type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  } as never);
  await new Promise((r) => setTimeout(r, waitMs));
}

function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, fn) as Promise<T>;
}

async function outboxPayloads(topic: string, idKey: string, id: string): Promise<Array<Record<string, unknown>>> {
  const rows = await sqlClient`SELECT payload FROM _outbox.messages WHERE topic = ${topic} AND payload->>${idKey} = ${id}`;
  return rows.map((r) => r.payload as Record<string, unknown>);
}

beforeAll(async () => {
  await inTenant(() =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({ id: LOCATION, tenantId: TENANT, name: "FQ9A HQ", businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(gates).values({ id: GATE, tenantId: TENANT, locationId: LOCATION, name: "FQ9A Gate", createdBy: ACTOR, updatedBy: ACTOR });
    }),
  );
});

afterAll(async () => {
  await sqlClient.end();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#31 SECURITY: no raw device token in the outbox", () => {
  it("register returns the token once, publishes only its hash, and the registered event carries no token", async () => {
    const published: Array<{ topic: string; env: { payload: Record<string, unknown> } }> = [];
    const spy = vi.spyOn(appQueue, "publish").mockImplementation(async (topic: string, env: unknown) => {
      published.push({ topic, env: env as { payload: Record<string, unknown> } });
      return undefined as never;
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/visitor/devices", headers: adminHeaders(),
      payload: { deviceType: "scanner", name: "FQ9A scanner", serialNumber: `SN-${randomUUID().slice(0, 8)}`, locationId: LOCATION },
    });
    await app.close();
    spy.mockRestore();

    expect(res.statusCode).toBe(202);
    expect(res.headers["cache-control"]).toBe("no-store");
    const data = res.json().data as { id: string; deviceToken?: string };
    expect(data.deviceToken).toMatch(/^device_/);
    const cmd = published.find((p) => p.topic === COMMANDS.deviceRegister);
    expect(cmd).toBeDefined();
    const sha = createHash("sha256").update(data.deviceToken as string).digest("hex");
    expect(cmd!.env.payload.tokenHash).toBe(sha);
    expect(JSON.stringify(cmd!.env)).not.toContain(data.deviceToken as string);

    // Drive the real consumer with the exact command the route published.
    const queue = tenantQueue(registerDeviceRegistryConsumers);
    await publishAndFlush(queue, COMMANDS.deviceRegister, cmd!.env.payload);

    const row = await inTenant(() => scopedRead((tx) => tx.select().from(devices).where(eq(devices.id, data.id))));
    expect(row[0]?.deviceTokenHash).toBe(sha);
    expect(row[0]?.deviceTokenLookup).toBe(blindIndex(sha));
    const events = await outboxPayloads("visitor.device.registered", "id", data.id);
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty("token");
    expect(events[0]).toMatchObject({ credentialIssued: true });
    expect(JSON.stringify(events)).not.toContain(data.deviceToken as string);
  }, 20000);

  it("credential rotation emits no token either", async () => {
    const deviceId = randomUUID();
    await inTenant(() => db.transaction((tx) => tx.insert(devices).values({
      id: deviceId, tenantId: TENANT, deviceType: "kiosk", name: "rot", serialNumber: `SN-${randomUUID().slice(0, 8)}`,
      locationId: LOCATION, status: "active", authType: "bearer_token", deviceTokenHash: "a".repeat(64), createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const queue = tenantQueue(registerDeviceRegistryConsumers);
    await publishAndFlush(queue, COMMANDS.deviceRotateCredential, { deviceId, tenantId: TENANT, tokenHash: "b".repeat(64) });
    const row = await inTenant(() => scopedRead((tx) => tx.select().from(devices).where(eq(devices.id, deviceId))));
    expect(row[0]?.deviceTokenHash).toBe("b".repeat(64));
    expect(row[0]?.oldTokenHash).toBe("a".repeat(64));
    const events = await outboxPayloads("visitor.device.credential_rotated", "id", deviceId);
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty("token");
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#27 PATCH device metadata is applied to the device row", () => {
  it("name + capabilities change; nothing is queued as device config", async () => {
    const deviceId = randomUUID();
    await inTenant(() => db.transaction((tx) => tx.insert(devices).values({
      id: deviceId, tenantId: TENANT, deviceType: "scanner", name: "before", serialNumber: `SN-${randomUUID().slice(0, 8)}`,
      locationId: LOCATION, status: "active", authType: "bearer_token", capabilities: { input: ["camera"] }, createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const queue = tenantQueue(registerDeviceRegistryConsumers);
    await publishAndFlush(queue, COMMANDS.deviceConfigPush, {
      deviceId, tenantId: TENANT, config: { _metadataUpdate: true, name: "after", capabilities: { input: ["qr", "camera"] } },
    });
    const row = (await inTenant(() => scopedRead((tx) => tx.select().from(devices).where(eq(devices.id, deviceId)))))[0];
    expect(row?.name).toBe("after");
    expect(row?.capabilities).toEqual({ input: ["qr", "camera"] });
    expect(row?.pendingConfig).toBeNull();
    expect(row?.version).toBe(2);
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#28 recurring pass create persists the row (and the digital pass it references)", () => {
  it("creates recurring_passes + digital_passes rows", async () => {
    const id = randomUUID();
    const passId = randomUUID();
    const queue = tenantQueue(registerRecurringPassConsumers);
    await publishAndFlush(queue, COMMANDS.recurringPassCreate, {
      id, passId, tenantId: TENANT, locationId: LOCATION, visitorName: "FQ9A Contractor", visitorPhone: "+911234567890",
      companyName: null, validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      permittedDays: [1, 2, 3, 4, 5], permittedTimeFrom: null, permittedTimeTo: null,
    }, id);
    const rp = await inTenant(() => scopedRead((tx) => tx.select().from(recurringPasses).where(eq(recurringPasses.id, id))));
    expect(rp).toHaveLength(1);
    expect(rp[0]?.passId).toBe(passId);
    expect(rp[0]?.status).toBe("active");
    const dp = await inTenant(() => scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, passId))));
    expect(dp).toHaveLength(1);
    expect(dp[0]?.passType).toBe("recurring");
    expect(dp[0]?.qrJwt.length).toBeGreaterThan(20);
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#29 one undecryptable blacklist row no longer poisons the list", () => {
  it("returns every row; the bad one masked + flagged, the good one decrypted", async () => {
    const good = randomUUID();
    const bad = randomUUID();
    await inTenant(() => db.transaction(async (tx) => {
      await tx.insert(blacklistEntries).values({ id: good, tenantId: TENANT, personName: "Readable Person", reason: "fq9a", status: "active", createdBy: ACTOR, updatedBy: ACTOR });
      // A legacy envelope under a key id the current keyring does not hold.
      await tx.execute(sql`INSERT INTO visitor.blacklist_entries (id, tenant_id, person_name, reason, status, created_by, updated_by)
        VALUES (${bad}::uuid, ${TENANT}::uuid, ${"enc:v2:retired-key:" + Buffer.alloc(40, 7).toString("base64")}, 'fq9a', 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    }));
    const { rows } = await inTenant(() => listBlacklistEntries(TENANT, {}));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(good)?.personName).toBe("Readable Person");
    expect(byId.get(good)?.piiDecryptFailed).toBeUndefined();
    expect(byId.get(bad)?.personName).toBe(UNDECRYPTABLE_PII_PLACEHOLDER);
    expect(byId.get(bad)?.piiDecryptFailed).toBe(true);
    expect(JSON.stringify(byId.get(bad))).not.toContain("enc:v2");
  }, 20000);

  it("GET /v1/visitor/blacklist is 200, not 500", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/visitor/blacklist", headers: adminHeaders() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect((res.json().data as Array<{ piiDecryptFailed?: boolean }>).some((r) => r.piiDecryptFailed === true)).toBe(true);
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#32 badge template update versions in place; rollback works", () => {
  it("PATCH keeps the id, bumps the version and keeps the old content; rollback restores it", async () => {
    const templateId = randomUUID();
    await inTenant(() => db.transaction((tx) => tx.insert(badgeTemplates).values({
      id: templateId, tenantId: TENANT, name: "FQ9A tpl v1", printerLanguage: "zpl", templateBody: "^XA{{visitor_name}}^XZ",
      visitorCategory: "default", createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const queue = tenantQueue(registerBadgePrintConsumers);
    const read = async () => (await inTenant(() => scopedRead((tx) => tx.select().from(badgeTemplates).where(eq(badgeTemplates.id, templateId)))))[0];

    await publishAndFlush(queue, COMMANDS.badgeTemplateUpdate, {
      templateId, tenantId: TENANT, name: "FQ9A tpl v2", templateBody: null, badgeWidthMm: null, badgeHeightMm: null, visitorCategory: null, op: "update",
    });
    const afterUpdate = await read();
    expect(afterUpdate?.name).toBe("FQ9A tpl v2");
    expect(afterUpdate?.status).toBe("active");
    expect(afterUpdate?.templateVersion).toBe(2);
    expect(afterUpdate?.previousVersionId).toBeTruthy();
    const activeForName = await inTenant(() => scopedRead((tx) => tx.select().from(badgeTemplates)
      .where(and(eq(badgeTemplates.tenantId, TENANT), eq(badgeTemplates.status, "active"), eq(badgeTemplates.visitorCategory, "default")))));
    expect(activeForName.filter((t) => t.name.startsWith("FQ9A tpl"))).toHaveLength(1);

    // Route-level: the rollback endpoint now finds a previous version on the SAME id.
    const spy = vi.spyOn(appQueue, "publish").mockImplementation(async () => undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/visitor/badges/templates/${templateId}/rollback`, headers: adminHeaders(), payload: {} });
    await app.close();
    spy.mockRestore();
    expect(res.statusCode).toBe(202);

    await publishAndFlush(queue, COMMANDS.badgeTemplateUpdate, {
      templateId, tenantId: TENANT, name: null, templateBody: null, badgeWidthMm: null, badgeHeightMm: null, visitorCategory: null, op: "rollback",
    });
    const afterRollback = await read();
    expect(afterRollback?.name).toBe("FQ9A tpl v1");
    expect(afterRollback?.status).toBe("active");
    expect(afterRollback?.templateVersion).toBe(3);
    expect(afterRollback?.previousVersionId).toBeNull();
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#37 heartbeat for a device without a gate", () => {
  it("authenticates the device token and returns the pending config (no 401 from an unmatchable encrypted lookup, no 500 from an empty tenant GUC)", async () => {
    const token = `device_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const deviceId = randomUUID();
    await inTenant(() => db.transaction((tx) => tx.insert(devices).values({
      id: deviceId, tenantId: TENANT, deviceType: "scanner", name: "hb", serialNumber: `SN-${randomUUID().slice(0, 8)}`,
      locationId: LOCATION, gateId: null, status: "active", authType: "bearer_token",
      deviceTokenHash: tokenHash, deviceTokenLookup: blindIndex(tokenHash),
      pendingConfig: { displayLanguage: "hi" }, configVersion: 1, createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const app = await buildApp();
    // Two calls: the second reuses a pooled connection whose app.tenant_id GUC was set then reset to ''.
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST", url: "/v1/visitor/devices/heartbeat",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { firmwareVersion: "1.2.3" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ config: { displayLanguage: "hi" }, configVersion: 1 });
    }
    await app.close();
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("#8 unknown gate / location is rejected synchronously", () => {
  it("POST /check-ins with an unknown gate → 422 UNKNOWN_GATE (not 202)", async () => {
    const spy = vi.spyOn(appQueue, "publish");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/visitor/check-ins", headers: adminHeaders(), payload: { passId: randomUUID(), gateId: randomUUID() } });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code ?? res.json().error?.code).toBe("UNKNOWN_GATE");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }, 20000);

  it("POST /check-ins with a real gate is still accepted", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockImplementation(async () => undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/visitor/check-ins", headers: adminHeaders(), payload: { passId: randomUUID(), gateId: GATE } });
    await app.close();
    spy.mockRestore();
    expect(res.statusCode).toBe(202);
  }, 20000);

  it("POST /devices with an unknown gate or location → 422", async () => {
    const spy = vi.spyOn(appQueue, "publish");
    const app = await buildApp();
    const base = { deviceType: "scanner", name: "x", serialNumber: "SN-FQ9A" };
    const r1 = await app.inject({ method: "POST", url: "/v1/visitor/devices", headers: adminHeaders(), payload: { ...base, locationId: LOCATION, gateId: randomUUID() } });
    const r2 = await app.inject({ method: "POST", url: "/v1/visitor/devices", headers: adminHeaders(), payload: { ...base, locationId: randomUUID() } });
    await app.close();
    expect(r1.statusCode).toBe(422);
    expect(r2.statusCode).toBe(422);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }, 20000);
});
