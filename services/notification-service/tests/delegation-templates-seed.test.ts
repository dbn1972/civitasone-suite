/** Migration 0051 seeds the four delegation templates the constants point at (real DB). */
import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { SYSTEM_TEMPLATE_IDS, buildNotificationPayload } from "@civitasone/events";
import { db } from "../src/shared/db.js";
import { notificationTemplates } from "../src/modules/templates/schema.js";

const PLATFORM_TENANT = "00000000-0000-0000-0000-000000000000";
const cases = [
  ["workflowDelegationCreated", "in_app", "workflow.delegation.created"],
  ["workflowDelegationRevoked", "in_app", "workflow.delegation.revoked"],
  ["workflowDelegationCreatedEmail", "email", "workflow.delegation.created"],
  ["workflowDelegationRevokedEmail", "email", "workflow.delegation.revoked"],
] as const;

describe("workflow delegation templates (migration 0051)", () => {
  for (const [key, channel] of cases) {
    it(`${key} is seeded as an active ${channel} template`, async () => {
      const [row] = await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
        tx.select().from(notificationTemplates)
          .where(and(eq(notificationTemplates.id, SYSTEM_TEMPLATE_IDS[key]), eq(notificationTemplates.tenantId, PLATFORM_TENANT))).limit(1));
      expect(row).toBeTruthy();
      expect(row.channel).toBe(channel);
      expect(row.status).toBe("active");
      for (const v of ["headline", "roles", "delegateName", "period"]) expect(row.body).toContain(`{{${v}}}`);
    });
  }
  it("event types map to the in-app templates by default", () => {
    expect(buildNotificationPayload({ eventType: "workflow.delegation.created", recipient: "x" }).templateId).toBe(SYSTEM_TEMPLATE_IDS.workflowDelegationCreated);
    expect(buildNotificationPayload({ eventType: "workflow.delegation.revoked", recipient: "x" }).templateId).toBe(SYSTEM_TEMPLATE_IDS.workflowDelegationRevoked);
  });
});
