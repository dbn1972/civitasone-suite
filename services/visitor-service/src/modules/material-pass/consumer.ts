/**
 * visitor-service: material-pass consumer.
 *
 * Handles `COMMANDS.materialPassCreate` and `COMMANDS.materialPassReconcile`:
 *
 * materialPassCreate:
 *   markProcessed(tx, msg.messageId) → insert `material_passes` rows (one
 *   per declared item, direction = "in") for the given pass/location.
 *
 * materialPassReconcile:
 *   markProcessed(tx, msg.messageId) → load declared items for the pass →
 *   run domain.reconcileOnExit + domain.handleUndeclaredItemOnExit →
 *   update rows' `reconciled_at` + `discrepancy` flags → if discrepancy OR
 *   undeclared items detected → outbox `securityIncidentCreated`
 *   (Requirements 13.3, 13.4).
 *
 * Follows the CQRS consumer pattern from modules/blacklist/consumer.ts.
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { materialPasses } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { locations } from "../location/schema.js";
import { reconcileOnExit, handleUndeclaredItemOnExit, type DeclaredItem } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "material-pass-consumer" });

// ── Payload Types ────────────────────────────────────────────────────────

interface MaterialPassCreatePayload {
  id: string;
  tenantId: string;
  passId: string;
  locationId: string;
  items: Array<{
    description: string;
    quantity: number;
    serialNumber?: string | null;
  }>;
}

interface MaterialPassReconcilePayload {
  id: string;
  tenantId: string;
  passId: string;
  locationId: string;
  itemsPresentAtExit: Array<{
    description: string;
    quantity: number;
    serialNumber?: string | null;
  }>;
}

// ── Registration ─────────────────────────────────────────────────────────

export function registerMaterialPassConsumers(queue: Queue): void {
  // ─── materialPassCreate ────────────────────────────────────────────────
  queue.subscribe<MaterialPassCreatePayload>(COMMANDS.materialPassCreate, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Tenant-boundary check: passId/locationId are caller-supplied foreign
      // ids. The material_passes FK constraints (pass_id -> digital_passes.id,
      // location_id -> locations.id) only prove the target exists SOMEWHERE,
      // not that it belongs to the caller's own tenant — without this check,
      // any tenant could plant a material_passes row (tagged with its own
      // tenant_id, so it reads back fine under that tenant's own RLS) that
      // references another tenant's real digital-pass/location rows, which
      // would corrupt any future feature that joins across tenant_id without
      // re-verifying ownership (analytics, support tooling, audit
      // correlation). Mirrors the identical ownership check
      // modules/check-in/consumer.ts already does for passId before it will
      // touch a digital pass.
      const passRows = await tx
        .select({ id: digitalPasses.id })
        .from(digitalPasses)
        .where(and(eq(digitalPasses.id, p.passId), eq(digitalPasses.tenantId, msg.tenantId)))
        .limit(1);
      if (!passRows[0]) {
        throw new Error(`digital pass '${p.passId}' not found for tenant '${msg.tenantId}'`);
      }

      const locationRows = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.id, p.locationId), eq(locations.tenantId, msg.tenantId)))
        .limit(1);
      if (!locationRows[0]) {
        throw new Error(`location '${p.locationId}' not found for tenant '${msg.tenantId}'`);
      }

      // Insert one row per declared item with direction = "in".
      for (const item of p.items) {
        await tx.insert(materialPasses).values({
          tenantId: msg.tenantId,
          passId: p.passId,
          locationId: p.locationId,
          itemDescription: item.description.trim(),
          serialNumber: item.serialNumber?.trim() || null,
          quantity: item.quantity,
          direction: "in",
          discrepancy: false,
          createdBy: msg.actorId,
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "material_pass", resourceId: p.passId, outcome: "success" } });
      }
    });

    log.info(
      { tenantId: msg.tenantId, passId: p.passId, itemCount: p.items.length },
      "material pass created",
    );
  });

  // ─── materialPassReconcile ─────────────────────────────────────────────
  queue.subscribe<MaterialPassReconcilePayload>(COMMANDS.materialPassReconcile, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Load declared items (direction = "in") for this pass + tenant.
      const declaredRows = await tx
        .select()
        .from(materialPasses)
        .where(
          and(
            eq(materialPasses.passId, p.passId),
            eq(materialPasses.tenantId, msg.tenantId),
            eq(materialPasses.direction, "in"),
          ),
        );

      const declaredItems: DeclaredItem[] = declaredRows.map((r) => ({
        description: r.itemDescription,
        quantity: r.quantity,
        serialNumber: r.serialNumber,
      }));

      // Run domain reconciliation.
      const reconciliation = reconcileOnExit(declaredItems, p.itemsPresentAtExit);
      const undeclaredResult = handleUndeclaredItemOnExit(p.itemsPresentAtExit, declaredItems);

      const now = new Date();

      // Mark all declared rows as reconciled. Flag discrepancy on rows whose
      // items are missing (matched by description / serial).
      for (const row of declaredRows) {
        const isMissing = reconciliation.missingItems.some(
          (m) =>
            m.description === row.itemDescription &&
            (m.serialNumber ?? null) === (row.serialNumber ?? null),
        );

        await tx
          .update(materialPasses)
          .set({
            reconciledAt: now,
            discrepancy: isMissing,
          })
          .where(eq(materialPasses.id, row.id));
      }

      // If discrepancy or undeclared items detected → outbox securityIncidentCreated.
      if (reconciliation.discrepancy || undeclaredResult.undeclaredItems.length > 0) {
        await enqueue(tx, {
          topic: EVENTS.securityIncidentCreated,
          eventType: EVENTS.securityIncidentCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            type: "material_discrepancy",
            passId: p.passId,
            locationId: p.locationId,
            missingItems: reconciliation.missingItems,
            undeclaredItems: undeclaredResult.undeclaredItems,
            reconciledAt: now.toISOString(),
          },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "create", resourceType: "security_incident", resourceId: msg.messageId, outcome: "success" } });
      }
    });

    log.info(
      { tenantId: msg.tenantId, passId: p.passId },
      "material pass reconciled",
    );
  });
}
