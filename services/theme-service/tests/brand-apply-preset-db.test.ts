/**
 * GAP-THEMES-BRAND-01 — activating a brand preset is a tenant-wide visual
 * change and MUST be audited.
 *
 * The activate capability already exists end-to-end: POST
 * /v1/themes/brand/apply-preset is admin-gated (theme_admin/super_admin),
 * validates the preset code, and its consumer writes the preset's colours into
 * the tenant's brand_config AND emits a `brandPresetApplied` + mandatory
 * `audit.event.record` event in the SAME transaction. This DB-backed test
 * proves the happy path the mocked all-routes suite does not: a real seeded
 * preset is applied, the tenant's brand_config takes the preset's colours, and
 * an audit event with action `apply-preset` is written.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerTokenConsumers } from "../src/modules/tokens/consumer.js";
import { brandConfig, brandPresets } from "../src/modules/tokens/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET as string; // injected by vitest.config.ts

const TENANT = randomUUID();
const ACTOR = randomUUID();
const PRESET_CODE = "india_govt_green"; // seeded by migration 0004

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-brand" }, SECRET, 3600);
}
function hdr(roles: string[]) {
  return { authorization: `Bearer ${token(roles)}`, "content-type": "application/json", "x-tenant-id": TENANT };
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

beforeAll(async () => {
  registerTokenConsumers(queue); // consumer internally runs under the message tenant GUC
  await queue.start();
  app = await buildApp();
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(brandConfig).where(eq(brandConfig.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/themes/brand/apply-preset — audited activation (GAP-THEMES-BRAND-01)", () => {
  it("401 without a token; 403 for a non-admin", async () => {
    const anon = await app.inject({ method: "POST", url: "/v1/themes/brand/apply-preset", payload: { code: PRESET_CODE } });
    expect(anon.statusCode).toBe(401);
    const user = await app.inject({
      method: "POST", url: "/v1/themes/brand/apply-preset",
      headers: hdr(["theme_user"]), payload: { code: PRESET_CODE },
    });
    expect(user.statusCode).toBe(403);
  });

  it("202 applies the preset's colours to the tenant brand_config", async () => {
    // The seeded preset's primary colour (migration 0004).
    const presetRows = await db.select().from(brandPresets).where(eq(brandPresets.code, PRESET_CODE)).limit(1);
    const preset = presetRows[0]!;
    expect(preset).toBeDefined();

    const res = await app.inject({
      method: "POST", url: "/v1/themes/brand/apply-preset",
      headers: hdr(["theme_admin"]), payload: { code: PRESET_CODE },
    });
    expect(res.statusCode).toBe(202);

    const row = await waitFor(async () => {
      const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(brandConfig)
        .where(eq(brandConfig.tenantId, TENANT))));
      return rows[0] ?? null;
    });
    expect(row.colorPrimary).toBe(preset.colorPrimary);
    expect(row.colorSecondary).toBe(preset.colorSecondary);
    expect(row.colorAccent).toBe(preset.colorAccent);
  });

  it("writes a brand apply-preset audit event in the same transaction", async () => {
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages)
      .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record")))));
    const audited = rows.some((r) => {
      const p = r.payload as { action?: string; resourceType?: string; service?: string };
      return p.service === "themes" && p.resourceType === "brand" && p.action === "apply-preset";
    });
    expect(audited).toBe(true);
  });

  it("404 for a non-existent preset code", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/themes/brand/apply-preset",
      headers: hdr(["theme_admin"]), payload: { code: "no-such-preset" },
    });
    expect(res.statusCode).toBe(404);
  });
});
