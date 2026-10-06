/**
 * GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01 — campaign send/cancel is an admin-only
 * commercial mass-send. This pins the server-side authorization so a future
 * change that drops the role gate on PATCH /notifications/campaigns/:id/send
 * (or /cancel) fails loudly: a non-admin must get 403, an admin 202.
 *
 * The consent/DND/opt-out suppression that the send CONSUMER applies per
 * recipient (decideGate, marketing required) is already pinned by
 * consent-gate*.test.ts and campaign-marketing.test.ts; this file covers the
 * route-level authorization boundary specifically.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { notificationCampaigns, notificationCampaignRecipients } from "../src/modules/bulk/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = "cccc0079-9999-4000-8000-000000000011";
const ACTOR = "cccc0079-9999-4000-8000-0000000000cc";
const SYSTEM = "00000000-0000-0000-0000-000000000001";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-authz" }, SECRET, 3600);
}
const bearer = (roles: string[]) => ({ authorization: `Bearer ${token(roles)}` });

async function seedCampaign(id: string, status: string): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(notificationCampaigns).values({
        id,
        tenantId: TENANT,
        templateId: randomUUID(),
        name: "Authz fixture",
        status,
        scheduledAt: null,
        objective: null,
        audienceSegmentId: null,
        budgetMinor: 0n,
        currency: "INR",
        createdBy: SYSTEM,
        updatedBy: SYSTEM,
      } as typeof notificationCampaigns.$inferInsert);
    }),
  );
}

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(notificationCampaignRecipients).where(eq(notificationCampaignRecipients.tenantId, TENANT));
      await tx.delete(notificationCampaigns).where(eq(notificationCampaigns.tenantId, TENANT));
    }),
  );
}

let app: FastifyInstance;
beforeAll(async () => {
  await cleanup();
  app = await buildApp();
});
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("campaign send/cancel authorization (GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01)", () => {
  it("PATCH /campaigns/:id/send → 403 for a non-admin role", async () => {
    const id = randomUUID();
    await seedCampaign(id, "draft");
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/campaigns/${id}/send`,
      headers: bearer(["notification_viewer"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /campaigns/:id/cancel → 403 for a non-admin role", async () => {
    const id = randomUUID();
    await seedCampaign(id, "draft");
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/campaigns/${id}/cancel`,
      headers: bearer(["notification_viewer"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /campaigns/:id/send → 202 for an admin role (tenant_admin)", async () => {
    const id = randomUUID();
    await seedCampaign(id, "draft");
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/campaigns/${id}/send`,
      headers: bearer(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });
});
