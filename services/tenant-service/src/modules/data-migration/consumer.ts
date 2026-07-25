import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { migrations, reconciliations } from "./schema.js";
import { eq } from "drizzle-orm";

const log = pino({ name: "data-migration-consumer" });

export function registerDataMigrationConsumers(q: Queue): void {
  q.subscribe("tenant.migration.start", async (msg) => {
    const p = msg.payload as { id: string; sourceTenantId: string; targetTenantId: string; entities: string[]; dryRun: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(migrations).values({
        id: p.id, tenantId: msg.tenantId, sourceTenantId: p.sourceTenantId,
        targetTenantId: p.targetTenantId, entities: p.entities,
        status: p.dryRun ? "dry_run" : "running", dryRun: String(p.dryRun), createdBy: msg.actorId,
      });
      log.info({ migrationId: p.id, entities: p.entities.length, dryRun: p.dryRun }, "migration started");
      // Simulate completion (real: iterate entities, copy rows)
      await tx.update(migrations).set({ status: "completed", recordsMigrated: 0, completedAt: new Date() }).where(eq(migrations.id, p.id));
    });
  });

  q.subscribe("tenant.reconciliation.start", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; entityType: string; sourceSystem: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(reconciliations).values({
        id: p.id, tenantId: p.tenantId, entityType: p.entityType,
        sourceSystem: p.sourceSystem, status: "running", createdBy: msg.actorId,
      });
      log.info({ reconId: p.id, entityType: p.entityType }, "reconciliation started");
      // Simulate completion
      await tx.update(reconciliations).set({ status: "completed", breakCount: 0 }).where(eq(reconciliations.id, p.id));
    });
  });

  q.subscribe("tenant.master_data.import", async (msg) => {
    const p = msg.payload as { batchId: string; entityType: string; recordCount: number; records: unknown[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      log.info({ batchId: p.batchId, entityType: p.entityType, records: p.recordCount }, "master data import processing");
      // Real: iterate records, validate each, insert into target table
      // For now: log completion (production would use bulk insert)
    });
  });

  q.subscribe("tenant.master_data.export", async (msg) => {
    const p = msg.payload as { exportId: string; entityType: string; format: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      log.info({ exportId: p.exportId, entityType: p.entityType, format: p.format }, "master data export generating");
      // Real: query target table, format as CSV/JSON, upload to S3
    });
  });
}
