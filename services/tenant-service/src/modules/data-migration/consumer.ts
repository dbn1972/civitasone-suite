/**
 * data-migration + bulk master-data consumers.
 *
 * CAP-020: import/export are now REAL. The import consumer validates every
 * record, persists the valid ones (transactionally) and records a per-record
 * error report on the batch; the export consumer materialises the tenant's rows
 * into a stored payload with a real record count. All handlers run inside
 * runWithTenant so FORCED RLS accepts writes and reads see the tenant's rows.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { and, eq, isNull, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { migrations, reconciliations, importBatches, exportJobs } from "./schema.js";
import { orgUnits } from "../org-hierarchy/schema.js";

const log = pino({ name: "data-migration-consumer" });
const UNIT_TYPES = new Set(["department", "division", "section", "unit", "branch"]);
const ORG_ENTITIES = new Set(["org_unit", "org_units", "orgUnit", "orgUnits"]);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface ImportError { index: number; error: string }

export function registerDataMigrationConsumers(q: Queue): void {
  q.subscribe("tenant.migration.start", async (msg) => {
    const p = msg.payload as { id: string; sourceTenantId: string; targetTenantId: string; entities: string[]; dryRun: boolean };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(migrations).values({
        id: p.id, tenantId: msg.tenantId, sourceTenantId: p.sourceTenantId,
        targetTenantId: p.targetTenantId, entities: p.entities,
        status: p.dryRun ? "dry_run" : "running", dryRun: String(p.dryRun), createdBy: msg.actorId,
      });
      await tx.update(migrations).set({ status: "completed", recordsMigrated: 0, completedAt: new Date() })
        .where(and(eq(migrations.id, p.id), eq(migrations.tenantId, msg.tenantId)));
    }));
  });

  q.subscribe("tenant.reconciliation.start", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; entityType: string; sourceSystem: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(reconciliations).values({
        id: p.id, tenantId: msg.tenantId, entityType: p.entityType,
        sourceSystem: p.sourceSystem, status: "running", createdBy: msg.actorId,
      });
      await tx.update(reconciliations).set({ status: "completed", breakCount: 0 })
        .where(and(eq(reconciliations.id, p.id), eq(reconciliations.tenantId, msg.tenantId)));
    }));
  });

  // CAP-020 — REAL bulk import: validate + persist + per-record error report.
  q.subscribe("tenant.master_data.import", async (msg) => {
    const p = msg.payload as { batchId: string; tenantId?: string; entityType: string; records: Record<string, unknown>[] };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const records = p.records ?? [];
      await tx.insert(importBatches).values({
        id: p.batchId, tenantId: msg.tenantId, entityType: p.entityType,
        status: "processing", total: records.length, createdBy: msg.actorId,
      });

      const errors: ImportError[] = [];
      let inserted = 0;

      if (ORG_ENTITIES.has(p.entityType)) {
        const existingCodes = await loadActiveCodes(tx, msg.tenantId);
        const seenCodes = new Set<string>();
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          if (!r) continue;
          const name = typeof r.name === "string" ? r.name.trim() : "";
          const type = typeof r.type === "string" ? r.type : "";
          const code = typeof r.code === "string" && r.code.length > 0 ? r.code : undefined;
          if (!name) { errors.push({ index: i, error: "name is required" }); continue; }
          if (!UNIT_TYPES.has(type)) { errors.push({ index: i, error: `invalid type: ${type || "(empty)"}` }); continue; }
          if (code && (existingCodes.has(code) || seenCodes.has(code))) {
            errors.push({ index: i, error: `duplicate code: ${code}` }); continue;
          }
          let level = 1;
          const parentId = typeof r.parentId === "string" ? r.parentId : undefined;
          if (parentId) {
            const parent = await tx.select().from(orgUnits)
              .where(and(eq(orgUnits.id, parentId), eq(orgUnits.tenantId, msg.tenantId))).limit(1);
            if (!parent[0]) { errors.push({ index: i, error: `parent not found: ${parentId}` }); continue; }
            level = parent[0].level + 1;
          }
          await tx.insert(orgUnits).values({
            id: randomUUID(), tenantId: msg.tenantId, name, type,
            parentId: parentId ?? null, code: code ?? null, level, createdBy: msg.actorId, version: 1,
          });
          if (code) seenCodes.add(code);
          inserted++;
        }
      } else {
        for (let i = 0; i < records.length; i++) errors.push({ index: i, error: `unsupported entity_type: ${p.entityType}` });
      }

      await tx.update(importBatches).set({
        status: errors.length > 0 && inserted === 0 ? "failed" : "completed",
        inserted, failed: errors.length, errors, completedAt: new Date(),
      }).where(and(eq(importBatches.id, p.batchId), eq(importBatches.tenantId, msg.tenantId)));
      log.info({ batchId: p.batchId, entityType: p.entityType, inserted, failed: errors.length }, "master data import completed");
    }));
  });

  // CAP-020 — REAL bulk export: materialise the tenant's rows into a stored payload.
  q.subscribe("tenant.master_data.export", async (msg) => {
    const p = msg.payload as { exportId: string; tenantId?: string; entityType: string; format: "json" | "csv" };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(exportJobs).values({
        id: p.exportId, tenantId: msg.tenantId, entityType: p.entityType,
        format: p.format, status: "generating", createdBy: msg.actorId,
      });

      let rows: Record<string, unknown>[] = [];
      if (ORG_ENTITIES.has(p.entityType)) {
        const data = await tx.select().from(orgUnits).where(eq(orgUnits.tenantId, msg.tenantId)).orderBy(orgUnits.level, orgUnits.name);
        rows = data.map((u) => ({ id: u.id, name: u.name, type: u.type, level: u.level, parentId: u.parentId, code: u.code }));
      }
      const payload = p.format === "csv" ? toCsv(rows) : JSON.stringify(rows);

      await tx.update(exportJobs).set({
        status: "completed", recordCount: rows.length, payload, completedAt: new Date(),
      }).where(and(eq(exportJobs.id, p.exportId), eq(exportJobs.tenantId, msg.tenantId)));
      log.info({ exportId: p.exportId, entityType: p.entityType, format: p.format, count: rows.length }, "master data export completed");
    }));
  });
}

async function loadActiveCodes(tx: Tx, tenantId: string): Promise<Set<string>> {
  const rows = await tx.select({ code: orgUnits.code }).from(orgUnits)
    .where(and(eq(orgUnits.tenantId, tenantId), isNull(orgUnits.effectiveTo), sql`${orgUnits.code} IS NOT NULL`));
  return new Set(rows.map((r) => r.code).filter((c): c is string => !!c));
}

function toCsv(rows: Record<string, unknown>[]): string {
  const cols = ["id", "name", "type", "level", "parentId", "code"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
