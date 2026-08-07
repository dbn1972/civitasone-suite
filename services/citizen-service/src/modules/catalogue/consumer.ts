import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertDefinitionPublishable } from "./domain.js";

const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType: "service_definition", resourceId, outcome: "success" },
  });
}

export function registerCatalogueConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.catalogueDefinitionCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; serviceKey: string; serviceId?: string; name: string;
      ownerDepartment?: string; eligibilityRuleSetId?: string; feeScheduleId?: string;
      issuanceType?: string; requiredDocuments: unknown[]; slaDays?: number;
      channels: unknown[]; forms?: unknown[]; outputs?: unknown[];
      servicePattern?: string; ownerOfficeId?: string; offeringOfficeIds?: string[];
      hoaCode?: string; feeModel?: string; statutoryReferences?: unknown[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const next = (await repo.latestVersionForKey(tx, p.tenantId, p.serviceKey)) + 1;
      await repo.insertDefinition(tx, {
        id: p.id, tenantId: p.tenantId, serviceKey: p.serviceKey,
        serviceId: p.serviceId ?? null, name: p.name,
        ownerDepartment: p.ownerDepartment ?? null,
        servicePattern: (p.servicePattern as never) ?? null,
        ownerOfficeId: p.ownerOfficeId ?? null,
        offeringOfficeIds: p.offeringOfficeIds ?? null,
        hoaCode: p.hoaCode ?? null,
        feeModel: (p.feeModel as never) ?? null,
        statutoryReferences: (p.statutoryReferences ?? []) as never,
        version: next, status: "draft",
        eligibilityRuleSetId: p.eligibilityRuleSetId ?? null,
        feeScheduleId: p.feeScheduleId ?? null,
        issuanceType: p.issuanceType ?? null,
        requiredDocuments: p.requiredDocuments as never,
        slaDays: p.slaDays ?? null,
        channels: p.channels as never,
        forms: (p.forms ?? []) as never,
        outputs: (p.outputs ?? []) as never,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "definition_create", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "catalogue", p.id));
  });

  queue.subscribe(COMMANDS.catalogueDefinitionUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      name?: string; serviceKey?: string; ownerDepartment?: string;
      slaDays?: number; channels?: unknown[]; requiredDocuments?: unknown[];
      servicePattern?: string; ownerOfficeId?: string; offeringOfficeIds?: string[];
      hoaCode?: string; feeModel?: string; statutoryReferences?: unknown[];
      forms?: unknown[]; formId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const def = await repo.findDefinitionByIdTx(tx, p.id, msg.tenantId);
      if (!def || def.status !== "draft") return;
      const patch: Record<string, unknown> = { updatedBy: msg.actorId };
      if (p.name !== undefined) patch.name = p.name;
      if (p.serviceKey !== undefined) patch.serviceKey = p.serviceKey;
      if (p.ownerDepartment !== undefined) patch.ownerDepartment = p.ownerDepartment;
      if (p.slaDays !== undefined) patch.slaDays = p.slaDays;
      if (p.channels !== undefined) patch.channels = p.channels;
      if (p.requiredDocuments !== undefined) patch.requiredDocuments = p.requiredDocuments;
      if (p.servicePattern !== undefined) patch.servicePattern = p.servicePattern;
      if (p.ownerOfficeId !== undefined) patch.ownerOfficeId = p.ownerOfficeId;
      if (p.offeringOfficeIds !== undefined) patch.offeringOfficeIds = p.offeringOfficeIds;
      if (p.hoaCode !== undefined) patch.hoaCode = p.hoaCode;
      if (p.feeModel !== undefined) patch.feeModel = p.feeModel;
      if (p.statutoryReferences !== undefined) patch.statutoryReferences = p.statutoryReferences;
      if (p.forms !== undefined) patch.forms = p.forms;
      if (p.formId !== undefined) patch.formId = p.formId;
      await repo.updateDefinition(tx, p.id, msg.tenantId, patch as never);
      await audit(tx, msg, "definition_update", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "catalogue", p.id));
  });

  queue.subscribe(COMMANDS.catalogueDefinitionSubmit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const def = await repo.findDefinitionByIdTx(tx, p.id, msg.tenantId);
      if (!def || def.status !== "draft") return;
      try { assertDefinitionPublishable(def); } catch { return; }
      await repo.updateDefinition(tx, p.id, msg.tenantId, { submittedBy: msg.actorId, updatedBy: msg.actorId });
      await audit(tx, msg, "definition_submit", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "catalogue", p.id));
  });

  queue.subscribe(COMMANDS.catalogueDefinitionPublish, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const def = await repo.findDefinitionByIdTx(tx, p.id, msg.tenantId);
      if (!def || def.status !== "draft" || !def.submittedBy) return;
      if (def.submittedBy === msg.actorId) return;
      try { assertDefinitionPublishable(def); } catch { return; }
      await repo.updateDefinition(tx, p.id, msg.tenantId, {
        status: "published", publishedBy: msg.actorId, publishedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.serviceDefinitionPublished, eventType: EVENTS.serviceDefinitionPublished,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, serviceKey: def.serviceKey, version: def.version, serviceId: def.serviceId },
      });
      await audit(tx, msg, "definition_publish", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "catalogue", p.id));
  });
}
