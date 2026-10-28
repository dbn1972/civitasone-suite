/**
 * GET /notifications/templates/:id -- the single-template read crm-service relies on
 * (send / bulk-send variable validation and template-preview, UAT DB test g2-crm-citizen).
 * It did not exist, so once crm authenticated correctly every lookup was a 404.
 *
 * Covers the internal service-to-service path crm uses (x-internal + x-service-secret) and
 * tenant isolation (findTemplateById itself is not tenant-filtered).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { notificationTemplates } from "../src/modules/templates/schema.js";
import type { FastifyInstance } from "fastify";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const TEMPLATE = randomUUID();
const SECRET_VALUE = "test_internal_secret_for_template_get"; // gitleaks:allow
const savedSecret = process.env.INTERNAL_SERVICE_SECRET;

let app: FastifyInstance;

const internal = (tenant: string) => ({
  "x-internal": "1",
  "x-service-secret": SECRET_VALUE,
  "x-internal-caller": "crm-service",
  "x-tenant-id": tenant,
});

beforeAll(async () => {
  process.env.INTERNAL_SERVICE_SECRET = SECRET_VALUE;
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(notificationTemplates).values({
      id: TEMPLATE, tenantId: TENANT, channel: "email", name: "Welcome", subject: "Hi",
      body: "Hello {{name}}", status: "active", version: 1, supersededBy: null,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(notificationTemplates).where(eq(notificationTemplates.tenantId, TENANT));
  }));
  if (savedSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
  else process.env.INTERNAL_SERVICE_SECRET = savedSecret;
  await sqlClient.end();
});

describe("GET /notifications/templates/:id", () => {
  it("returns the template (body included) over the internal service path", async () => {
    const res = await app.inject({ method: "GET", url: `/notifications/templates/${TEMPLATE}`, headers: internal(TENANT) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: TEMPLATE, tenantId: TENANT, body: "Hello {{name}}" });
  });

  it("404s for another tenant's template (no cross-tenant read)", async () => {
    const res = await app.inject({ method: "GET", url: `/notifications/templates/${TEMPLATE}`, headers: internal(OTHER_TENANT) });
    expect(res.statusCode).toBe(404);
  });

  it("404s for an unknown id and 401s without credentials", async () => {
    const unknown = await app.inject({ method: "GET", url: `/notifications/templates/${randomUUID()}`, headers: internal(TENANT) });
    expect(unknown.statusCode).toBe(404);
    const anon = await app.inject({ method: "GET", url: `/notifications/templates/${TEMPLATE}` });
    expect(anon.statusCode).toBe(401);
  });
});
