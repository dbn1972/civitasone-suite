import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS, EVENTS, RESOURCE } from "../../topics.js";
import * as eventsRepo from "../events/repo.js";
import * as repo from "./repo.js";
import { MAX_EXPORT_ROWS, PII_EXPORT_ROLES } from "./validators.js";
import { contentDigest, signManifest, signingKeyId, SIGNATURE_ALG, type ExportManifest } from "./signing.js";

const AUDIT_TOPIC = CONSUMED_EVENTS.auditEventRecord;

// P1-5: where artifacts land. Tenant-scoped subdir; download served via tenant-scoped token route.
const EXPORT_DIR = process.env.EXPORT_DIR ?? "/tmp/audit-exports";
// P1-5: how long a completed artifact is retained / downloadable.
const RETENTION_DAYS = Number(process.env.EXPORT_RETENTION_DAYS ?? 7);

type PiiField = "ipAddress" | "userAgent" | "oldValue" | "newValue";
const PII_FIELDS: PiiField[] = ["ipAddress", "userAgent", "oldValue", "newValue"];

// H3: thrown when an export's window exceeds the row cap; routed to failExportVersioned.
class ExportTooLargeError extends Error {
  readonly code = "EXPORT_TOO_LARGE";
  constructor(cap: number) {
    super(`[EXPORT_TOO_LARGE] export exceeds the ${cap}-row cap; narrow the date window and retry`);
    this.name = "ExportTooLargeError";
  }
}

function hasPiiRole(roles: string[]): boolean {
  return roles.some((r) => PII_EXPORT_ROLES.includes(r));
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // L3: neutralize CSV/spreadsheet formula injection — a leading = + - @ (or a
  // leading tab / CR that some apps strip before re-evaluating) makes the cell a
  // formula. Prefix with a single quote so it is rendered as literal text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function registerExportConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.exportCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; from: string; to: string;
      format: "json" | "csv"; includePii?: boolean; roles?: string[];
    };

    // P1-5: enforce PII gating server-side again (defense in depth) — strip if not allowed.
    const roles = p.roles ?? [];
    const allowPii = (p.includePii ?? false) && hasPiiRole(roles);

    // 1) Insert the 'pending' row (preserves prior behaviour) + emit requested event + audit.
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertExport(tx, {
        id: p.id, tenantId: p.tenantId,
        periodFrom: new Date(p.from), periodTo: new Date(p.to),
        format: p.format, status: "pending",
        includesPii: allowPii, requestedRoles: roles.join(","),
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.exportRequested, eventType: EVENTS.exportRequested,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { exportId: p.id, from: p.from, to: p.to, format: p.format, includesPii: allowPii },
      });
      await audit(tx, msg, "create", RESOURCE.export, p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.export, p.id));

    // 2) Produce the artifact and complete the row (or mark failed). Runs after the insert tx
    //    so a re-delivery that already inserted (markProcessed=false) still reaches completion
    //    via the versioned, status-guarded update.
    try {
      // H3: probe for one row beyond the cap. If the window genuinely exceeds
      // MAX_EXPORT_ROWS we must FAIL the export rather than silently truncating it
      // into a "completed" artifact that is missing rows.
      const rows = await eventsRepo.listEvents(p.tenantId, new Date(p.from), new Date(p.to), undefined, MAX_EXPORT_ROWS + 1, 0);
      if (rows.length > MAX_EXPORT_ROWS) {
        throw new ExportTooLargeError(MAX_EXPORT_ROWS);
      }

      const projected = rows.map((r) => {
        const base: Record<string, unknown> = {
          id: r.id, type: r.type, severity: r.severity,
          actor: r.actor, target: r.target, payload: r.payload,
          correlationId: r.correlationId, occurredAt: r.occurredAt,
          prevHash: r.prevHash, eventHash: r.eventHash,
        };
        if (allowPii) for (const f of PII_FIELDS) base[f] = r[f];
        return base;
      });

      let content: string;
      if (p.format === "csv") {
        const headers = projected.length ? Object.keys(projected[0]!) : ["id", "type", "severity", "occurredAt"];
        const lines = [headers.join(",")];
        for (const row of projected) lines.push(headers.map((h) => csvCell(row[h])).join(","));
        content = lines.join("\n");
      } else {
        content = JSON.stringify({ exportId: p.id, from: p.from, to: p.to, includesPii: allowPii, count: projected.length, rows: projected }, null, 2);
      }

      // AUD-2: tamper-evidence. Digest the exact artifact bytes, then sign a
      // canonical manifest binding that digest to the export identity. Both are
      // persisted (DB) and written as an offline-verifiable `.sig.json` sidecar.
      const contentSha256 = contentDigest(content);
      // Normalize the window to canonical ISO (matches periodFrom/To.toISOString()
      // used by the /verify endpoint) so the signed manifest is reproducible.
      const manifestCore = {
        exportId: p.id, tenantId: p.tenantId,
        from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString(),
        format: p.format, includesPii: allowPii, rowCount: projected.length,
        contentSha256,
      };
      const signature = signManifest(manifestCore);
      const signedAt = new Date();
      const manifest: ExportManifest = {
        ...manifestCore, signingKeyId: signingKeyId(), alg: SIGNATURE_ALG,
      };

      const token = randomUUID().replace(/-/g, "");
      const now = Date.now();
      const expiresAt = new Date(now + RETENTION_DAYS * 86_400_000);
      const tenantDir = path.join(EXPORT_DIR, p.tenantId);
      const fileName = `${p.id}.${p.format}`;
      // H2: artifacts may carry PII. Lock the tree down to the service user only —
      // dir 0700, file 0600 — so co-tenants / other local users cannot read them.
      // (mkdir mode is masked by umask, so chmod explicitly to guarantee perms.)
      await mkdir(tenantDir, { recursive: true, mode: 0o700 });
      await chmod(tenantDir, 0o700);
      const filePath = path.join(tenantDir, fileName);
      await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
      await chmod(filePath, 0o600);

      // AUD-2: detached signature sidecar — lets a regulator verify the artifact
      // offline (recompute SHA-256 of the data file, recompute HMAC of manifest).
      const sigPath = path.join(tenantDir, `${p.id}.sig.json`);
      await writeFile(sigPath, JSON.stringify({ ...manifest, signature, signedAt: signedAt.toISOString() }, null, 2), { encoding: "utf8", mode: 0o600 });
      await chmod(sigPath, 0o600);

      // tenant-scoped, time-limited download location.
      const downloadPath = `/v1/audit/exports/${p.id}/download?token=${token}`;

      await db.transaction(async (tx) => {
        const row = await repo.findByIdTx(tx, p.id, p.tenantId);
        if (!row || row.status !== "pending") return; // already finalized / re-delivery
        const done = await repo.completeExportVersioned(tx, p.id, p.tenantId, row.version ?? 1, {
          signedUrl: downloadPath, downloadToken: token, rowCount: projected.length,
          retentionUntil: expiresAt, expiresAt, updatedBy: msg.actorId,
          contentSha256, signature, signedAt, signingKeyId: signingKeyId(), signatureAlg: SIGNATURE_ALG,
        });
        if (done === 1) {
          await audit(tx, msg, "complete", RESOURCE.export, p.id);
        }
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.export, p.id));
    } catch (err) {
      await db.transaction(async (tx) => {
        const row = await repo.findByIdTx(tx, p.id, p.tenantId);
        if (!row || row.status !== "pending") return;
        await repo.failExportVersioned(tx, p.id, p.tenantId, row.version ?? 1, String((err as Error)?.message ?? err));
      });
      throw err;
    }
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType, resourceId, outcome: "success" },
  });
}
