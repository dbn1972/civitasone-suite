/**
 * Real-DB regressions for UAT FQ12 theme-service defects.
 *
 *  #152 #153 #154 PUT /brand, POST /brand/apply-preset and PUT /branding returned
 *       202 but dead-lettered: the projected row crosses the broker as JSON, so
 *       createdAt/updatedAt arrive as ISO strings and drizzle's timestamp column
 *       threw `value.toISOString is not a function` inside the consumer tx.
 *  #150 #151 tokens / templates / revisions/latest / branding were written but
 *       read back empty: the repos read with a bare db.select() (no app.tenant_id
 *       GUC) against FORCE RLS tables.
 *
 * The commands the HTTP layer publishes are captured and delivered to the real
 * consumers AFTER a JSON round-trip, exactly as the SQS driver delivers them.
 * Requests carry no x-tenant-id header, so reads must scope from the JWT tenant.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { registerTokenConsumers } from "../src/modules/tokens/consumer.js";
import { registerBrandingConsumers } from "../src/modules/branding/consumer.js";
import { registerTemplateConsumers } from "../src/modules/templates/consumer.js";
import { brandConfig, brandPresets } from "../src/modules/tokens/schema.js";
import * as tokenRepo from "../src/modules/tokens/repo.js";
import * as templateRepo from "../src/modules/templates/repo.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const auth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["theme_admin"], sid: "sess-fq12" }, SECRET, 3600)}` };

type Handler = (msg: CommandEnvelope) => Promise<void>;
const handlers = new Map<string, Handler[]>();
/** Broker stand-in: consumers subscribe here; deliver() hands them a JSON copy. */
const broker = {
  subscribe: (topic: string, h: Handler) => { handlers.set(topic, [...(handlers.get(topic) ?? []), h]); },
  publish: async () => randomUUID(),
  start: async () => {},
  stop: async () => {},
  healthCheck: async () => ({ healthy: true, driver: "memory" as const }),
} as unknown as Queue;

const published: Array<{ topic: string; msg: CommandEnvelope }> = [];

async function deliverAll(): Promise<void> {
  const batch = published.splice(0);
  for (const { topic, msg } of batch) {
    const wire = JSON.parse(JSON.stringify(msg)) as CommandEnvelope; // what SQS hands the worker
    const hs = handlers.get(topic) ?? [];
    expect(hs.length, `no consumer subscribed to ${topic}`).toBeGreaterThan(0);
    for (const h of hs) await h(wire);
  }
}

const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

let app: FastifyInstance;

beforeAll(async () => {
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, input: unknown) => {
    const msg = input as CommandEnvelope;
    published.push({ topic, msg });
    return msg.messageId ?? randomUUID();
  });
  registerTokenConsumers(broker);
  registerBrandingConsumers(broker);
  registerTemplateConsumers(broker);
  app = await buildApp();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await asTenant(async (tx) => {
    for (const t of ["_outbox.messages", "theme.brand_config", "theme.tokens", "templates.templates", "theme.revisions", "branding.tenant_branding"]) {
      await tx.execute(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`)).catch(() => undefined);
    }
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("UAT FQ12 #152/#153 brand writes survive the JSON wire format", () => {
  it("PUT /v1/themes/brand persists brand_config", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/themes/brand", headers: auth,
      payload: { appName: "FQ12 Brand", colorPrimary: "#0a5c36", colorAccent: "#c2410c", borderRadius: "6px" },
    });
    expect(res.statusCode).toBe(202);
    await deliverAll();
    const rows = await asTenant((tx) => tx.select().from(brandConfig).where(eq(brandConfig.tenantId, TENANT)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.appName).toBe("FQ12 Brand");
    expect(rows[0]!.colorPrimary).toBe("#0a5c36");
  });

  it("POST /v1/themes/brand/apply-preset applies the preset to the existing row", async () => {
    const preset = (await db.select().from(brandPresets).where(eq(brandPresets.code, "india_govt_green")).limit(1))[0];
    expect(preset).toBeDefined();
    const res = await app.inject({
      method: "POST", url: "/v1/themes/brand/apply-preset", headers: auth, payload: { code: "india_govt_green" },
    });
    expect(res.statusCode).toBe(202);
    await deliverAll();
    const rows = await asTenant((tx) => tx.select().from(brandConfig).where(eq(brandConfig.tenantId, TENANT)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.colorPrimary).toBe(preset!.colorPrimary);
  });
});

describe("UAT FQ12 #154 PUT /v1/themes/branding persists and reads back", () => {
  it("writes branding.tenant_branding and GET /v1/themes/branding returns it", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/themes/branding", headers: auth,
      payload: { appName: "FQ12 Branding", primaryColor: "#1e40af", accentColor: "#f59e0b" },
    });
    expect(res.statusCode).toBe(202);
    await deliverAll();
    await cache.invalidateResource(TENANT, "branding");
    const got = await app.inject({ method: "GET", url: "/v1/themes/branding", headers: auth });
    expect(got.statusCode).toBe(200);
    expect(got.json().appName).toBe("FQ12 Branding");
  });
});

describe("UAT FQ12 #150/#151 RLS read-back of tokens, templates and revisions", () => {
  it("a created token is listed and fetchable", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/themes/tokens", headers: auth,
      payload: { name: "fq12.color.brand", value: "#123456", category: "color" },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json().data?.id ?? res.json().id) as string;
    await deliverAll();

    // Repo reads directly (no cache in the way) must see the row.
    expect((await tokenRepo.findById(id, TENANT))?.name).toBe("fq12.color.brand");
    expect((await tokenRepo.listByTenant(TENANT, 100, 0)).map((t) => t.id)).toContain(id);

    const list = await app.inject({ method: "GET", url: "/v1/themes/tokens?limit=100", headers: auth });
    expect(list.statusCode).toBe(200);
    expect((list.json().data as Array<{ id: string }>).map((t) => t.id)).toContain(id);
  });

  it("a created template is listed", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/themes/templates", headers: auth,
      payload: { type: "email", name: "FQ12 tpl", htmlBody: "<p>hi</p>" },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json().data?.id ?? res.json().id) as string;
    await deliverAll();

    expect((await templateRepo.findById(id, TENANT))?.name).toBe("FQ12 tpl");
    const list = await app.inject({ method: "GET", url: "/v1/themes/templates", headers: auth });
    expect(list.statusCode).toBe(200);
    expect((list.json().data as Array<{ id: string }>).map((t) => t.id)).toContain(id);
  });

  it("GET /v1/themes/revisions/latest returns the published revision", async () => {
    const pub = await app.inject({
      method: "POST", url: "/v1/themes/publish", headers: auth,
      payload: { name: "FQ12 publish", reason: "uat regression" },
    });
    expect(pub.statusCode).toBeLessThan(300);
    const latest = await app.inject({ method: "GET", url: "/v1/themes/revisions/latest", headers: auth });
    expect(latest.statusCode).toBe(200);
    const body = latest.json();
    const rev = body?.data ?? body;
    expect(rev).not.toBeNull();
    expect(rev.name).toBe("FQ12 publish");
  });
});
