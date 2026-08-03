/**
 * products/consumer.ts — applies product mutation commands to Postgres.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { productAvailability } from "./schema.js";
import * as repo from "./repo.js";
import * as gov from "./governance-repo.js";

const log = pino({ name: "catalogue.products.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerProductConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createProduct, async (msg) => {
    const p = msg.payload as {
      id: string;
      name: string;
      description: string | null;
      lineId: string | null;
      familyId: string | null;
      parentId: string | null;
      lifecycleStatus: string;
      effectiveFrom: string | null;
      effectiveTo: string | null;
      regulatoryMetadata: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertProduct(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        description: p.description,
        lineId: p.lineId,
        familyId: p.familyId,
        parentId: p.parentId,
        lifecycleStatus: p.lifecycleStatus,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        regulatoryMetadata: p.regulatoryMetadata,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.productCreated,
        eventType: EVENTS.productCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.id,
          name: p.name,
          lifecycleStatus: p.lifecycleStatus,
          ...(p.lineId !== null ? { lineId: p.lineId } : {}),
          ...(p.familyId !== null ? { familyId: p.familyId } : {}),
          ...(p.parentId !== null ? { parentId: p.parentId } : {}),
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product.create",
        resourceType: "catalogue_product",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "product created");
  });

  queue.subscribe(COMMANDS.updateProduct, async (msg) => {
    const p = msg.payload as { id: string; version: number; patch: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateProduct(tx, p.id, msg.tenantId, p.patch as never, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.productUpdated,
        eventType: EVENTS.productUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { productId: p.id, patch: p.patch, previousVersion: p.version },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product.update",
        resourceType: "catalogue_product",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
  });

  queue.subscribe(COMMANDS.deleteProduct, async (msg) => {
    const p = msg.payload as { id: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.softDelete(tx, p.id, msg.tenantId, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.productDeleted,
        eventType: EVENTS.productDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { productId: p.id, lifecycleStatus: "withdrawn", previousVersion: p.version },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product.delete",
        resourceType: "catalogue_product",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.recordProductAvailability, async (msg) => {
    const p = msg.payload as {
      id: string;
      productId: string;
      circleId: string | null;
      regionId: string | null;
      officeId: string | null;
      available: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(productAvailability).values({
        id: p.id,
        tenantId: msg.tenantId,
        productId: p.productId,
        circleId: p.circleId,
        regionId: p.regionId,
        officeId: p.officeId,
        available: p.available ? 1 : 0,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.productUpdated,
        eventType: EVENTS.productUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.productId,
          availabilityId: p.id,
          circleId: p.circleId,
          regionId: p.regionId,
          officeId: p.officeId,
          available: p.available,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product.availability.record",
        resourceType: "catalogue_product",
        resourceId: p.productId,
      });
    });
  });

  queue.subscribe(COMMANDS.openProductVersion, async (msg) => {
    const p = msg.payload as {
      id: string;
      productId: string;
      changeSummary: string;
      versionNumber: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await gov.insertVersion(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        productId: p.productId,
        versionNumber: p.versionNumber,
        status: "draft",
        changeSummary: p.changeSummary,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.productVersionOpened,
        eventType: EVENTS.productVersionOpened,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.productId,
          versionId: p.id,
          versionNumber: p.versionNumber,
          status: "draft",
          changeSummary: p.changeSummary,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product_version.open",
        resourceType: "catalogue_product_version",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.submitProductVersion, async (msg) => {
    const p = msg.payload as {
      versionId: string;
      productId: string;
      versionNumber: number;
      version: number;
      submittedAt: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await gov.updateVersionStatus(
        tx,
        p.versionId,
        msg.tenantId,
        {
          status: "pending_approval",
          submittedAt: new Date(p.submittedAt),
          submittedBy: msg.actorId,
          updatedBy: msg.actorId,
        },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.productVersionSubmitted,
        eventType: EVENTS.productVersionSubmitted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.productId,
          versionId: p.versionId,
          versionNumber: p.versionNumber,
          status: "pending_approval",
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product_version.submit",
        resourceType: "catalogue_product_version",
        resourceId: p.versionId,
      });
    });
  });

  queue.subscribe(COMMANDS.approveProductVersion, async (msg) => {
    const p = msg.payload as {
      versionId: string;
      productId: string;
      versionNumber: number;
      version: number;
      makerId: string;
      comment: string | null;
      approvedAt: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await gov.updateVersionStatus(
        tx,
        p.versionId,
        msg.tenantId,
        {
          status: "approved",
          approvedBy: msg.actorId,
          approvedAt: new Date(p.approvedAt),
          updatedBy: msg.actorId,
        },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.productVersionApproved,
        eventType: EVENTS.productVersionApproved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.productId,
          versionId: p.versionId,
          versionNumber: p.versionNumber,
          status: "approved",
          makerId: p.makerId,
          checkerId: msg.actorId,
          ...(p.comment !== null ? { comment: p.comment } : {}),
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product_version.approve",
        resourceType: "catalogue_product_version",
        resourceId: p.versionId,
      });
    });
  });

  queue.subscribe(COMMANDS.rejectProductVersion, async (msg) => {
    const p = msg.payload as {
      versionId: string;
      productId: string;
      versionNumber: number;
      version: number;
      makerId: string;
      reason: string;
      rejectedAt: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await gov.updateVersionStatus(
        tx,
        p.versionId,
        msg.tenantId,
        {
          status: "rejected",
          rejectionReason: p.reason,
          rejectedBy: msg.actorId,
          rejectedAt: new Date(p.rejectedAt),
          updatedBy: msg.actorId,
        },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.productVersionRejected,
        eventType: EVENTS.productVersionRejected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.productId,
          versionId: p.versionId,
          versionNumber: p.versionNumber,
          status: "rejected",
          reason: p.reason,
          makerId: p.makerId,
          checkerId: msg.actorId,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product_version.reject",
        resourceType: "catalogue_product_version",
        resourceId: p.versionId,
      });
    });
  });

  queue.subscribe(COMMANDS.transitionProductLifecycle, async (msg) => {
    const p = msg.payload as {
      productId: string;
      lifecycleId: string;
      fromState: string | null;
      toState: string;
      effectiveFrom: string;
      reason: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await gov.insertLifecycle(tx, {
        id: p.lifecycleId,
        tenantId: msg.tenantId,
        productId: p.productId,
        state: p.toState,
        effectiveFrom: new Date(p.effectiveFrom),
        reason: p.reason,
        createdBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.productLifecycleChanged,
        eventType: EVENTS.productLifecycleChanged,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.productId,
          lifecycleId: p.lifecycleId,
          fromState: p.fromState,
          toState: p.toState,
          effectiveFrom: p.effectiveFrom,
          ...(p.reason !== null ? { reason: p.reason } : {}),
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product.lifecycle.transition",
        resourceType: "catalogue_product",
        resourceId: p.productId,
        details: { fromState: p.fromState, toState: p.toState },
      });
    });
  });

  queue.subscribe(COMMANDS.upsertRegulatoryMetadata, async (msg) => {
    const p = msg.payload as {
      productId: string;
      rowId: string;
      created: boolean;
      version: number | null;
      regulation: string;
      complianceStatus: string;
      notes: string | null;
      validFrom: string | null;
      validUntil: string | null;
      reviewedAt: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (p.created) {
        await gov.insertRegulatory(tx, {
          id: p.rowId,
          tenantId: msg.tenantId,
          productId: p.productId,
          regulation: p.regulation,
          complianceStatus: p.complianceStatus,
          notes: p.notes,
          validFrom: p.validFrom ? new Date(p.validFrom) : null,
          validUntil: p.validUntil ? new Date(p.validUntil) : null,
          reviewedAt: p.reviewedAt ? new Date(p.reviewedAt) : null,
          reviewerId: msg.actorId,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
      } else {
        const ok = await gov.updateRegulatory(
          tx,
          p.productId,
          msg.tenantId,
          {
            regulation: p.regulation,
            complianceStatus: p.complianceStatus,
            notes: p.notes,
            validFrom: p.validFrom ? new Date(p.validFrom) : null,
            validUntil: p.validUntil ? new Date(p.validUntil) : null,
            reviewedAt: p.reviewedAt ? new Date(p.reviewedAt) : null,
            reviewerId: msg.actorId,
            updatedBy: msg.actorId,
          },
          p.version ?? 1,
        );
        if (!ok) return;
      }
      await enqueue(tx, {
        topic: EVENTS.regulatoryMetadataUpserted,
        eventType: EVENTS.regulatoryMetadataUpserted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.productId,
          regulatoryId: p.rowId,
          regulation: p.regulation,
          complianceStatus: p.complianceStatus,
          created: p.created,
          validUntil: p.validUntil,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product.regulatory.upsert",
        resourceType: "catalogue_product",
        resourceId: p.productId,
      });
    });
  });

  queue.subscribe(COMMANDS.setProductAvailability, async (msg) => {
    const p = msg.payload as {
      productId: string;
      rows: Array<{
        id: string;
        circleCode: string | null;
        regionCode: string | null;
        officeCode: string | null;
        available: boolean;
        effectiveFrom: string;
        effectiveTo: string | null;
      }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await gov.replaceAvailabilityV2(
        tx,
        p.productId,
        msg.tenantId,
        p.rows.map((r) => ({
          id: r.id,
          tenantId: msg.tenantId,
          productId: p.productId,
          circleCode: r.circleCode,
          regionCode: r.regionCode,
          officeCode: r.officeCode,
          available: r.available,
          effectiveFrom: new Date(r.effectiveFrom),
          effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        })),
      );
      await enqueue(tx, {
        topic: EVENTS.productAvailabilityChanged,
        eventType: EVENTS.productAvailabilityChanged,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { productId: p.productId, rowCount: p.rows.length },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product.availability.set",
        resourceType: "catalogue_product",
        resourceId: p.productId,
        details: { rowCount: p.rows.length },
      });
    });
  });

  queue.subscribe(COMMANDS.createCrossSellRule, async (msg) => {
    const p = msg.payload as {
      id: string;
      sourceProductId: string;
      targetProductId: string;
      ruleType: string;
      priority: number;
      enabled: boolean;
      note: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await gov.insertCrossSell(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        sourceProductId: p.sourceProductId,
        targetProductId: p.targetProductId,
        ruleType: p.ruleType,
        priority: p.priority,
        enabled: p.enabled,
        note: p.note,
        createdBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.crossSellRuleCreated,
        eventType: EVENTS.crossSellRuleCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          ruleId: p.id,
          sourceProductId: p.sourceProductId,
          targetProductId: p.targetProductId,
          ruleType: p.ruleType,
          priority: p.priority,
          enabled: p.enabled,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "cross_sell.create",
        resourceType: "catalogue_cross_sell_rule",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.deleteCrossSellRule, async (msg) => {
    const p = msg.payload as {
      ruleId: string;
      sourceProductId: string;
      targetProductId: string;
      ruleType: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await gov.deleteCrossSell(tx, p.ruleId, msg.tenantId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.crossSellRuleDeleted,
        eventType: EVENTS.crossSellRuleDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          ruleId: p.ruleId,
          sourceProductId: p.sourceProductId,
          targetProductId: p.targetProductId,
          ruleType: p.ruleType,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "cross_sell.delete",
        resourceType: "catalogue_cross_sell_rule",
        resourceId: p.ruleId,
      });
    });
  });

  queue.subscribe(COMMANDS.classifyProduct, async (msg) => {
    const p = msg.payload as {
      productId: string;
      productCode: string;
      category: string;
      taxRateBps: number;
      version: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateProduct(
        tx,
        p.productId,
        msg.tenantId,
        {
          productCode: p.productCode,
          category: p.category,
          taxRateBps: p.taxRateBps,
          updatedBy: msg.actorId,
        } as never,
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.productClassified,
        eventType: EVENTS.productClassified,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          productId: p.productId,
          productCode: p.productCode,
          category: p.category,
          taxRateBps: p.taxRateBps,
          previousVersion: p.version,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "product.classify",
        resourceType: "catalogue_product",
        resourceId: p.productId,
      });
    });
  });
}
