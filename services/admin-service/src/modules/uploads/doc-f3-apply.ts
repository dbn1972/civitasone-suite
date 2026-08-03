/** F3 CQRS apply functions for uploads/doc-routes. */
import { db } from "../../shared/db.js";
import { auditEvent, domainEvent, type OutboxCtx } from "../../shared/audit.js";
import { HttpError } from "../../shared/context.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./doc-repo.js";
import {
  classifyExpiry,
  daysUntil,
  assertExpiryPresentWhenRequired,
  assertExpiryAfterIssue,
  assertExtensionAllowed,
  assertTypeActive,
  assertVersionMatch,
} from "./doc-domain.js";

const RESOURCE_TYPE = "document_type";
const RESOURCE_DOC = "document";

function outboxCtx(ctx: { tenantId: string; actorId: string; correlationId: string }): OutboxCtx {
  return { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId };
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

type Req = { body: any; params: any; query: any };

export async function apply_uploads_0(ctx: any, req: Req): Promise<void> {
  const body = req.body;
  await db.transaction(async (tx) => {
    const w = tx as repo.Writer;
    const clash = await repo.findTypeByCodeTx(w, ctx.tenantId, body.code);
    if (clash) throw new HttpError(409, "TYPE_EXISTS", `document type '${body.code}' already exists`);
    const row = await repo.insertType(w, {
      tenantId: ctx.tenantId,
      code: body.code,
      name: body.name,
      category: body.category,
      allowedExtensions: body.allowedExtensions,
      maxSizeMb: body.maxSizeMb,
      expiryRequired: body.expiryRequired,
      expiryWarnDays: body.expiryWarnDays,
      status: "active",
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });
    await auditEvent(tx, outboxCtx(ctx), "document_type.created", RESOURCE_TYPE, row.id, { code: row.code });
  });
}

export async function apply_uploads_1(ctx: any, req: Req): Promise<void> {
  const body = req.body;
  const { id } = req.params;
  const patchKeys = (["name", "maxSizeMb", "expiryRequired", "expiryWarnDays", "status"] as const).filter(
    (k) => body[k] !== undefined,
  );
  await db.transaction(async (tx) => {
    const w = tx as repo.Writer;
    const row = await repo.findTypeTx(w, ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "document type not found");
    assertVersionMatch(row.version, body.expectedVersion);
    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    for (const key of patchKeys) patch[key] = body[key];
    const moved = await repo.updateType(w, ctx.tenantId, id, body.expectedVersion, patch);
    if (!moved) throw new HttpError(409, "VERSION_CONFLICT", "document type was modified concurrently; re-read and retry");
    await auditEvent(tx, outboxCtx(ctx), "document_type.updated", RESOURCE_TYPE, id);
  });
}

export async function apply_uploads_2(ctx: any, req: Req): Promise<void> {
  const body = req.body;
  await db.transaction(async (tx) => {
    const w = tx as repo.Writer;
    const type = await repo.findTypeByCodeTx(w, ctx.tenantId, body.documentTypeCode);
    if (!type) throw new HttpError(404, "NOT_FOUND", `document type '${body.documentTypeCode}' not found`);
    assertTypeActive(type.status);
    const row = await repo.upsertRequirement(w, {
      tenantId: ctx.tenantId,
      contextType: body.contextType,
      contextKey: body.contextKey,
      documentTypeCode: body.documentTypeCode,
      mandatory: body.mandatory,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });
    await auditEvent(tx, outboxCtx(ctx), "document_requirement.set", RESOURCE_TYPE, row.id, {
      contextType: row.contextType, documentTypeCode: row.documentTypeCode, mandatory: row.mandatory,
    });
  });
}

export async function apply_uploads_3(ctx: any, req: Req): Promise<void> {
  const body = req.body;
  await db.transaction(async (tx) => {
    const w = tx as repo.Writer;
    const type = await repo.findTypeByCodeTx(w, ctx.tenantId, body.documentTypeCode);
    if (!type) throw new HttpError(404, "NOT_FOUND", `document type '${body.documentTypeCode}' not found`);
    assertTypeActive(type.status);
    assertExpiryPresentWhenRequired(type.expiryRequired, body.expiresAt);
    assertExpiryAfterIssue(body.issuedAt, body.expiresAt);
    assertExtensionAllowed(body.storageKey, type.allowedExtensions);
    const expiresAt = body.expiresAt !== undefined ? new Date(body.expiresAt) : null;
    const status = classifyExpiry("active", expiresAt, type.expiryWarnDays);
    const row = await repo.insertDocument(w, {
      tenantId: ctx.tenantId,
      documentTypeCode: body.documentTypeCode,
      contextType: body.contextType,
      contextKey: body.contextKey,
      subjectId: body.subjectId,
      storageKey: body.storageKey,
      issuedAt: body.issuedAt !== undefined ? new Date(body.issuedAt) : null,
      expiresAt,
      status,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });
    await auditEvent(tx, outboxCtx(ctx), "document.registered", RESOURCE_DOC, row.id, {
      documentTypeCode: row.documentTypeCode, subjectId: row.subjectId,
    });
  });
}

export async function apply_uploads_4(ctx: any, req: Req): Promise<void> {
  const body = req.body ?? {};
  await db.transaction(async (tx) => {
    const w = tx as repo.Writer;
    const now = new Date();
    const { rows: typeRows } = await repo.listTypes(ctx.tenantId, 200, 0, "active");
    const widestWarnDays = typeRows.reduce((m, t) => (t.expiryWarnDays > m ? t.expiryWarnDays : m), 30);
    const horizon = new Date(now.getTime() + widestWarnDays * 24 * 60 * 60_000);
    const warnDays: Record<string, number> = {};
    for (const t of typeRows) warnDays[t.code] = t.expiryWarnDays;
    const candidates = await repo.expiryCandidatesTx(w, ctx.tenantId, horizon, body.limit ?? 500);
    let expiring = 0;
    let expired = 0;
    let unchanged = 0;
    let recovered = 0;
    for (const doc of candidates) {
      const next = classifyExpiry(doc.status, doc.expiresAt, warnDays[doc.documentTypeCode] ?? 30, now);
      if (next === doc.status) {
        unchanged++;
        continue;
      }
      const alerting = next === "expiring" || next === "expired";
      const moved = await repo.updateDocument(w, ctx.tenantId, doc.id, doc.version, {
        status: next, ...(alerting ? { lastAlertAt: now } : {}), updatedBy: ctx.actorId,
      });
      if (!moved) {
        unchanged++;
        continue;
      }
      const base = {
        documentId: doc.id,
        documentTypeCode: doc.documentTypeCode,
        contextType: doc.contextType,
        contextKey: doc.contextKey,
        subjectId: doc.subjectId,
        expiresAt: iso(doc.expiresAt) ?? "",
      };
      if (next === "expiring") {
        expiring++;
        await domainEvent(tx, outboxCtx(ctx), EVENTS.documentExpiring, {
          ...base, daysRemaining: doc.expiresAt !== null ? daysUntil(doc.expiresAt, now) : 0,
        });
      } else if (next === "expired") {
        expired++;
        await domainEvent(tx, outboxCtx(ctx), EVENTS.documentExpired, base);
      } else {
        recovered++;
      }
    }
    await auditEvent(tx, outboxCtx(ctx), "document.expiry_scan", RESOURCE_DOC, ctx.tenantId, {
      scanned: candidates.length, expiring, expired, unchanged, recovered,
    });
  });
}
