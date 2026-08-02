import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { formVersions, formPublicEndpoints } from "./schema.js";

export function registerFormConsumers(q: Queue): void {
  q.subscribe(COMMANDS.FORM_MUTATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const op = p.op as string;
      if (op === "create_version" || op === "revise_version") {
        await tx.insert(formVersions).values({
          id: p.id,
          tenantId: p.tenantId,
          layoutDefId: p.layoutId,
          versionNumber: p.versionNumber,
          status: "draft",
          visibilityRules: p.visibilityRules,
          cascadeRules: p.cascadeRules,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
      } else if (op === "update_version") {
        await tx.update(formVersions).set({
          cascadeRules: p.cascadeRules,
          visibilityRules: p.visibilityRules,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
          version: (p.version ?? 0) + 1,
        }).where(and(eq(formVersions.id, p.id), eq(formVersions.tenantId, p.tenantId)));
      } else if (op === "submit_version") {
        await tx.update(formVersions).set({
          status: "pending_approval",
          submittedBy: msg.actorId,
          submittedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        }).where(and(eq(formVersions.id, p.id), eq(formVersions.tenantId, p.tenantId)));
      } else if (op === "approve_version") {
        const now = new Date();
        const existing = await tx.select().from(formVersions)
          .where(and(eq(formVersions.id, p.id), eq(formVersions.tenantId, p.tenantId))).limit(1);
        if (!existing[0]) return;
        await tx.update(formVersions).set({
          status: "published", publishedBy: msg.actorId, publishedAt: now,
          updatedAt: now, updatedBy: msg.actorId, version: existing[0].version + 1,
        }).where(and(eq(formVersions.id, p.id), eq(formVersions.tenantId, p.tenantId), eq(formVersions.status, "pending_approval")));
        const prior = await tx.select({ id: formVersions.id }).from(formVersions).where(and(
          eq(formVersions.layoutDefId, existing[0].layoutDefId),
          eq(formVersions.tenantId, p.tenantId),
          eq(formVersions.status, "published"),
          sql`${formVersions.id} <> ${p.id}`,
        ));
        for (const row of prior) {
          await tx.update(formVersions).set({ status: "superseded", supersededBy: p.id, updatedAt: now, updatedBy: msg.actorId })
            .where(and(eq(formVersions.id, row.id), eq(formVersions.tenantId, p.tenantId)));
        }
        await enqueue(tx, {
          topic: EVENTS.FORM_VERSION_PUBLISHED, eventType: EVENTS.FORM_VERSION_PUBLISHED,
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { formVersionId: p.id, layoutDefId: existing[0].layoutDefId, tenantId: p.tenantId, publishedAt: now.toISOString() },
        });
      } else if (op === "reject_version") {
        await tx.update(formVersions).set({
          status: "draft", submittedBy: null, submittedAt: null,
          updatedAt: new Date(), updatedBy: msg.actorId,
        }).where(and(eq(formVersions.id, p.id), eq(formVersions.tenantId, p.tenantId)));
      } else if (op === "create_public_endpoint") {
        await tx.insert(formPublicEndpoints).values({
          id: p.id, tenantId: p.tenantId, formVersionId: p.formVersionId,
          publicKey: p.publicKey, label: p.label, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: `form_${op}`, resourceType: "form_version", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
