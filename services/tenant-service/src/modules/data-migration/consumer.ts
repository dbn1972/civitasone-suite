/**
 * data-migration + bulk master-data consumers.
 *
 * CAP-020: import/export are now REAL. The import consumer validates every
 * record, persists the valid ones (each behind a SAVEPOINT so one bad row can
 * never roll back the batch header or the already-inserted rows) and records a
 * per-record error report on the batch; the export consumer materialises the
 * tenant's rows into a stored payload with a real record count. All handlers run
 * inside runWithTenant so FORCED RLS accepts writes and reads see the tenant's
 * rows.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { and, eq, isNull, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { migrations, reconciliations, importBatches, exportJobs } from "./schema.js";
import { orgUnits } from "../org-hierarchy/schema.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "data-migration-consumer" });
const UNIT_TYPES = new Set(["department", "division", "section", "unit", "branch"]);
const ORG_ENTITIES = new Set(["org_unit", "org_units", "orgUnit", "orgUnits"]);
// DB column bounds (tenant.org_units): name varchar(200), code varchar(32). A
// record exceeding these is rejected into the error report — never handed to the
// insert, where an oversized value would raise a PostgresError.
const MAX_NAME_LEN = 200;
const MAX_CODE_LEN = 32;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface ImportError { index: number; row: number; field: string; error: string }

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
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant-service", action: "process", resourceType: "data_migration", resourceId: p.id, outcome: "success" } });
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
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant-service", action: "process", resourceType: "data_migration", resourceId: p.id, outcome: "success" } });
    }));
  });

  // CAP-020 — REAL bulk import: validate + persist + per-record error report.
  // The batch header is inserted first and the final status/error-report update
  // runs in the SAME outer transaction, but every per-record insert is isolated
  // behind its own SAVEPOINT (tx.transaction). A row that still raises at the DB
  // (e.g. an unforeseen constraint) rolls back only that savepoint, so the
  // header always COMMITS and the client can always poll status + error report
  // (never a permanent 404). CAP-020 guarantee: rejected-with-report, never
  // silently dropped.
  // OWNER DECISION #23: the records that did not load are remembered on the
  // batch (failed_records) so a migration admin can retry ONLY those.
  q.subscribe("tenant.master_data.import", async (msg) => {
    const p = msg.payload as { batchId: string; tenantId?: string; entityType: string; records: Record<string, unknown>[] };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const records = p.records ?? [];
      await tx.insert(importBatches).values({
        id: p.batchId, tenantId: msg.tenantId, entityType: p.entityType,
        status: "processing", total: records.length, createdBy: msg.actorId,
      });

      const { inserted, errors, failedRecords } = await loadRecords(tx, msg.tenantId, msg.actorId, p.entityType,
        records.map((record, index) => ({ index, record })));

      await tx.update(importBatches).set({
        status: errors.length > 0 && inserted === 0 ? "failed" : "completed",
        inserted, failed: errors.length, errors, failedRecords, completedAt: new Date(),
      }).where(and(eq(importBatches.id, p.batchId), eq(importBatches.tenantId, msg.tenantId)));
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant-service", action: "process", resourceType: "data_migration", resourceId: p.batchId, outcome: "success" } });
      log.info({ batchId: p.batchId, entityType: p.entityType, inserted, failed: errors.length }, "master data import completed");
    }));
  });

  // OWNER DECISION #23 (TENANT-DATA-MIGRATION-01): retry the FAILED records of a
  // batch only. One transaction: markProcessed + row lock + guarded write + audit.
  // Records that already loaded are never re-inserted; the batch counters and the
  // error report are rewritten from what is still failing.
  q.subscribe("tenant.master_data.import.retry", async (msg) => {
    const p = msg.payload as { batchId: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const found = await tx.select().from(importBatches)
        .where(and(eq(importBatches.id, p.batchId), eq(importBatches.tenantId, msg.tenantId))).limit(1).for("update");
      const batch = found[0];
      if (!batch || batch.status === "processing" || (batch.failedRecords ?? []).length === 0) {
        log.warn({ batchId: p.batchId }, "import retry: nothing to retry");
        return;
      }
      const before = batch.failedRecords.length;
      const { inserted, errors, failedRecords } = await loadRecords(tx, msg.tenantId, msg.actorId, batch.entityType, batch.failedRecords);
      const totalInserted = batch.inserted + inserted;
      await tx.update(importBatches).set({
        status: errors.length > 0 && totalInserted === 0 ? "failed" : "completed",
        inserted: totalInserted, failed: errors.length, errors, failedRecords,
        retryCount: batch.retryCount + 1, lastRetryAt: new Date(), lastRetryBy: msg.actorId, completedAt: new Date(),
      }).where(and(eq(importBatches.id, p.batchId), eq(importBatches.tenantId, msg.tenantId)));
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "tenant-service", action: "retry_failed_records", resourceType: "import_batch", resourceId: p.batchId, outcome: "success",
          retried: before, recovered: inserted, stillFailing: errors.length, attempt: batch.retryCount + 1,
        },
      });
      log.info({ batchId: p.batchId, retried: before, recovered: inserted, stillFailing: errors.length }, "master data import retry completed");
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
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant-service", action: "process", resourceType: "data_migration", resourceId: p.exportId, outcome: "success" } });
      log.info({ exportId: p.exportId, entityType: p.entityType, format: p.format, count: rows.length }, "master data export completed");
    }));
  });
}

/**
 * Validate + persist records of one entity type. Each record keeps its ORIGINAL
 * position (`index`, 0-based) across retries so the error report always points at
 * the row of the uploaded file. Failures carry the offending `field`; a DB-level
 * failure is reported generically (the cause is logged, never shown to the user).
 */
async function loadRecords(
  tx: Tx, tenantId: string, actorId: string, entityType: string,
  items: { index: number; record: Record<string, unknown> }[],
): Promise<{ inserted: number; errors: ImportError[]; failedRecords: { index: number; record: Record<string, unknown> }[] }> {
  const errors: ImportError[] = [];
  const failed = new Map<number, Record<string, unknown>>();
  let inserted = 0;
  const reject = (it: { index: number; record: Record<string, unknown> }, field: string, error: string) => {
    errors.push({ index: it.index, row: it.index + 1, field, error });
    failed.set(it.index, it.record);
  };

  if (!ORG_ENTITIES.has(entityType)) {
    for (const it of items) reject(it, "entityType", `unsupported entity_type: ${entityType}`);
  } else {
    const existingCodes = await loadActiveCodes(tx, tenantId);
    const seenCodes = new Set<string>();
    for (const it of items) {
      const r = it.record;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const type = typeof r.type === "string" ? r.type : "";
      const code = typeof r.code === "string" && r.code.length > 0 ? r.code : undefined;
      if (!name) { reject(it, "name", "name is required"); continue; }
      if (name.length > MAX_NAME_LEN) { reject(it, "name", `name exceeds ${MAX_NAME_LEN} characters (got ${name.length})`); continue; }
      if (!UNIT_TYPES.has(type)) { reject(it, "type", `invalid type: ${type || "(empty)"}`); continue; }
      if (code && code.length > MAX_CODE_LEN) { reject(it, "code", `code exceeds ${MAX_CODE_LEN} characters (got ${code.length})`); continue; }
      if (code && (existingCodes.has(code) || seenCodes.has(code))) { reject(it, "code", `duplicate code: ${code}`); continue; }
      let level = 1;
      const parentId = typeof r.parentId === "string" ? r.parentId : undefined;
      if (parentId) {
        const parent = await tx.select().from(orgUnits)
          .where(and(eq(orgUnits.id, parentId), eq(orgUnits.tenantId, tenantId))).limit(1);
        if (!parent[0]) { reject(it, "parentId", `parent not found: ${parentId}`); continue; }
        level = parent[0].level + 1;
      }
      // SAVEPOINT per row: an unexpected DB-level failure rolls back only
      // this row, never the batch header or the rows already inserted.
      try {
        await tx.transaction(async (sp) => {
          await sp.insert(orgUnits).values({
            id: randomUUID(), tenantId, name, type,
            parentId: parentId ?? null, code: code ?? null, level, createdBy: actorId, version: 1,
          });
        });
        if (code) seenCodes.add(code);
        inserted++;
      } catch (err) {
        log.warn({ err, index: it.index }, "import row insert failed");
        reject(it, "(row)", "the record could not be saved");
      }
    }
  }
  return { inserted, errors, failedRecords: [...failed.entries()].map(([index, record]) => ({ index, record })) };
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
