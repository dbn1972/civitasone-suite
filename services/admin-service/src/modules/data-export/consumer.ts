/**
 * Data export consumer — processes export requests.
 * Creates the request record, then processes it (collects data → generates file → uploads).
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { exportRequests, type ExportFile } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { putObject } from "@civitasone/storage";
import { planExport, toCsv, type Row } from "./exporters.js";

const log = pino({ name: "admin-data-export-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "data_export";
const EXPIRY_HOURS = 48;
/** UTF-8 byte-order mark so Excel opens non-ASCII CSV correctly. */
const CSV_BOM = "\uFEFF";

function cacheKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerDataExportConsumers(queue: Queue): void {
  // Handle export request creation
  queue.subscribe<{
    id: string; tenantId: string; requestedBy: string;
    type: "full" | "module" | "entity"; moduleFilter: string | null;
    format: "csv" | "json" | "pdf";
    purpose?: string | null; entityId?: string | null;
  }>("admin.data_export.request", async (msg) => {
    try {
      // GAP2-TENANT-ADMIN-DATA-EXPORT-07: the request row is inserted as
      // `pending`; the follow-up `admin.data_export.process` command (which
      // drives pending → ready and produces the downloadUrl) was never
      // produced by any production code, so the export was stuck at `pending`
      // forever and the download endpoint returned 409 permanently. Chain the
      // processing command here. `created` is only true on the FIRST delivery
      // (markProcessed is idempotent), so a redelivery never re-publishes a
      // duplicate process command.
      let created = false;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).insert(exportRequests).values({
          id: p.id,
          tenantId: p.tenantId,
          requestedBy: p.requestedBy,
          type: p.type,
          moduleFilter: p.moduleFilter,
          entityId: p.entityId ?? null,
          format: p.format,
          status: "pending",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        // GAP-TENANT-ADMIN-DATA-EXPORT-02: record purpose/entity in the audit event.
        await emit(tx, msg, "admin.data_export.requested", {
          ...p,
          purpose: p.purpose ?? null,
          entityId: p.entityId ?? null,
        }, "request", p.id);
        created = true;
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
      if (created) {
        // Trigger processing. Only after the request row has been committed, so
        // the process consumer always finds the row it is asked to advance.
        await queue.publish("admin.data_export.process", {
          messageId: randomUUID(),
          type: "admin.data_export.process",
          tenantId: msg.payload.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          schemaVersion: "1.0",
          payload: { exportId: msg.payload.id, tenantId: msg.payload.tenantId },
        });
      }
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.data_export.request" }, "Consumer processing failed");
    }
  });

  // OWNER DECISION #22: processing now GENERATES the files and stores them via
  // packages/storage. Three short transactions, never one held open across the
  // upload: (1) claim the request (markProcessed + pending -> processing) and read
  // the data, (2) upload outside any transaction, (3) record ready/failed + audit
  // atomically. A failure records a machine reason only, never raw error text.
  queue.subscribe<{ exportId: string; tenantId: string }>("admin.data_export.process", async (msg) => {
    try {
      const p = msg.payload;
      type Claimed = { type: "full" | "module" | "entity"; format: "csv" | "json" | "pdf"; moduleFilter: string | null; entityId: string | null };
      let claimed: Claimed | null = null;
      let generated: { exporter: { entity: string; columns: string[] }; rows: Row[] }[] = [];
      let failure: string | null = null;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const found = await (tx as any).select().from(exportRequests)
          .where(and(eq(exportRequests.id, p.exportId), eq(exportRequests.tenantId, p.tenantId))).limit(1);
        const row = found[0];
        if (!row || row.status !== "pending") return;
        claimed = { type: row.type, format: row.format, moduleFilter: row.moduleFilter ?? null, entityId: row.entityId ?? null };
        await (tx as any).update(exportRequests).set({ status: "processing", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(eq(exportRequests.id, p.exportId), eq(exportRequests.tenantId, p.tenantId)));
        if (row.format === "pdf") { failure = "UNSUPPORTED_FORMAT"; return; }
        const plan = planExport(row.type, row.moduleFilter ?? null, row.entityId ?? null);
        if (!plan.ok) { failure = plan.reason; return; }
        for (const exporter of plan.exporters) generated.push({ exporter, rows: await exporter.load(tx, p.tenantId) });
      });
      if (!claimed) return;
      const req = claimed as Claimed;

      let files: ExportFile[] = [];
      if (!failure) {
        try {
          const base = `data-exports/${p.tenantId}/${p.exportId}`;
          if (req.format === "json") {
            const body = JSON.stringify({
              exportId: p.exportId, tenantId: p.tenantId, generatedAt: new Date().toISOString(),
              entities: Object.fromEntries(generated.map((g) => [g.exporter.entity, g.rows])),
            });
            await putObject(`${base}/export.json`, body, "application/json");
            files = [{ entity: "all", key: `${base}/export.json`, contentType: "application/json", sizeBytes: Buffer.byteLength(body), rowCount: generated.reduce((n, g) => n + g.rows.length, 0) }];
          } else {
            for (const g of generated) {
              const body = `${CSV_BOM}${toCsv(g.exporter.columns, g.rows)}`;
              await putObject(`${base}/${g.exporter.entity}.csv`, body, "text/csv; charset=utf-8");
              files.push({ entity: g.exporter.entity, key: `${base}/${g.exporter.entity}.csv`, contentType: "text/csv", sizeBytes: Buffer.byteLength(body), rowCount: g.rows.length });
            }
          }
        } catch (err) {
          log.error({ err, exportId: p.exportId }, "data export upload failed");
          failure = "STORAGE_FAILED";
        }
      }

      await db.transaction(async (tx) => {
        if (failure) {
          await (tx as any).update(exportRequests).set({ status: "failed", failureReason: failure, updatedBy: msg.actorId, updatedAt: new Date() })
            .where(and(eq(exportRequests.id, p.exportId), eq(exportRequests.tenantId, p.tenantId)));
          await emit(tx, msg, "admin.data_export.failed", { ...p, reason: failure }, "process", p.exportId, "failure");
          return;
        }
        const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);
        await (tx as any).update(exportRequests).set({
          status: "ready",
          downloadUrl: `/v1/admin/data-export/${p.exportId}/download`,
          expiresAt,
          files,
          fileSizeBytes: files.reduce((n, f) => n + f.sizeBytes, 0),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        }).where(and(eq(exportRequests.id, p.exportId), eq(exportRequests.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.data_export.ready", {
          ...p, expiresAt: expiresAt.toISOString(),
          fileCount: files.length, rowCount: files.reduce((n, f) => n + f.rowCount, 0),
        }, "process", p.exportId);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.data_export.process" }, "Consumer processing failed");
    }
  });

  // OWNER DECISION #22: every issue of a signed download link is audited. The
  // download route publishes this BEFORE it returns any link (fail closed).
  queue.subscribe<{ exportId: string; tenantId: string; fileCount: number; linkTtlSeconds: number }>("admin.data_export.download", async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await emit(tx, msg, "admin.data_export.downloaded", { ...p }, "download", p.exportId);
    });
  });
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
  outcome: "success" | "failure" = "success",
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "admin", action, resourceType: RESOURCE, resourceId, outcome,
      // GAP-TENANT-ADMIN-DATA-EXPORT-02: surface the recorded purpose/entity on
      // the audit record when present (personal-data egress must be reasoned).
      ...(typeof payload.purpose === "string" ? { purpose: payload.purpose } : {}),
      ...(typeof payload.entityId === "string" ? { entityId: payload.entityId } : {}),
    },
  });
}
