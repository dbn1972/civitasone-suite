/**
 * document module — SQS/RabbitMQ consumer handlers (CQRS write side).
 *
 * Every handler follows the mandatory pattern (steering: Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — if it returns false the message was
 *      already processed, so we skip (idempotency; P30).
 *   3. Business write (INSERT / optimistic-locked `versionedUpdate`).
 *   4. Emit domain EVENTS + an audit event via the transactional outbox (same tx).
 *   5. AFTER commit, invalidate the read-through cache.
 *
 * Handlers:
 *   • document.upload  → download the staged object, RE-VALIDATE the MIME server-side
 *                        (defence-in-depth, Req 15.1), compute the SHA-256 content hash
 *                        (Req 15.2), resolve the version number from the previous-version
 *                        link (Req 15.4), then INSERT the metadata row.
 *   • document.remove  → soft-delete (set `deleted_at`; never a hard delete).
 *   • agenda_book.generate  → aggregate the meeting's agenda items + documents, render a
 *                        paginated PDF via @civitasone/render with a classification footer
 *                        + watermark, store it, and INSERT the agenda-book document row
 *                        (Req 4.1, 4.3, 15.3).
 *   • agenda_book.circulate → render a PER-RECIPIENT watermarked copy for each recipient
 *                        (Req 4.3) and notify them via notification-service (Req 4.4).
 *
 * Heavy object-storage + PDF-render IO is performed BEFORE the DB transaction so the DB
 * connection is not held across network calls; the transaction only does the fast
 * idempotency-guarded write + outbox enqueue.
 *
 * Registration: `registerDocumentConsumers(register)` maps each topic to its handler.
 * worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 4.1, 4.3, 4.4, 15.1, 15.2, 15.4, 15.7_
 */
import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { renderPdf } from "@civitasone/render";
import { db, scopedRead } from "../../shared/db.js";
import { cache, storage } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { meetings } from "../meeting-core/schema.js";
import { agendaItems } from "../agenda/schema.js";
import { meetingDocuments } from "./schema.js";
import { checkMimeConsistent, rankOf, CLASSIFICATIONS, type Classification } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "document";
const CACHE_RESOURCE_VERSIONS = "document_versions";
const AGENDA_BOOK_MIME = "application/pdf";

// ─── Command payload contracts (mirror topics.ts JSDoc) ────────────────────────

interface DocumentUploadPayload {
  documentId: string;
  tenantId: string;
  meetingId: string;
  agendaItemId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  classification: string;
  documentType?: string;
  retentionYears?: number;
  previousVersionId?: string;
}

interface DocumentRemovePayload {
  documentId: string;
  meetingId: string;
  version: number;
  reason?: string;
}

interface AgendaBookGeneratePayload {
  tenantId: string;
  meetingId: string;
  agendaBookId: string;
  templateId?: string;
  includeAtr?: boolean;
}

interface AgendaBookCirculatePayload {
  tenantId: string;
  meetingId: string;
  agendaBookId: string;
  recipientIds?: string[];
}

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Emit an audit fact for every mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: SERVICE,
      action,
      resourceType: "meeting_document",
      resourceId,
      outcome: "success",
      ...(extra ?? {}),
    },
  });
}

/** Compute the retention expiry (Req 15.7). `retentionYears === 0` ⇒ permanent (null). */
function computeExpiresAt(retentionYears: number, from: Date): Date | null {
  if (retentionYears <= 0) return null;
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + retentionYears);
  return d;
}

/** Invalidate the read caches touched by a document write. */
async function invalidateDocument(tenantId: string, documentId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, documentId));
  await cache.invalidateResource(tenantId, CACHE_RESOURCE_VERSIONS);
}

// ─── document.upload ─────────────────────────────────────────────────────────

/**
 * document.upload → download the staged object, re-validate MIME server-side, hash it,
 * resolve the version number, and INSERT the metadata row (Req 15.1, 15.2, 15.4).
 */
async function handleDocumentUpload(msg: CommandEnvelope<DocumentUploadPayload>): Promise<void> {
  const p = msg.payload;

  // Fetch the staged bytes (read-only, idempotent). A storage error here is transient →
  // let it throw so the worker retries; only a genuine content problem is non-retryable.
  const buffer = await storage.getObject(p.storageKey);

  // Defence-in-depth server-side MIME validation (Req 15.1). A mismatch is a permanent
  // rejection: best-effort remove the staged object, then dead-letter (no retry).
  const rejection = checkMimeConsistent(p.fileName, p.mimeType, buffer);
  if (rejection) {
    try {
      await storage.deleteObject(p.storageKey);
    } catch {
      /* best-effort cleanup of the orphaned staged object */
    }
    throw new NonRetryableError(`document ${p.documentId} rejected: MIME validation failed (${rejection})`);
  }

  const hash = createHash("sha256").update(buffer).digest("hex");
  const retentionYears = p.retentionYears ?? 5;
  const now = new Date();
  const expiresAt = computeExpiresAt(retentionYears, now);
  const classification: Classification = (CLASSIFICATIONS as readonly string[]).includes(p.classification)
    ? (p.classification as Classification)
    : "internal";

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    // Version control (Req 15.4): a replacement carries `previousVersionId`; the new row's
    // version_num is the predecessor's + 1 (defaults to 1 for a first upload).
    let versionNum = 1;
    if (p.previousVersionId) {
      const prev = await tx
        .select({ versionNum: meetingDocuments.versionNum })
        .from(meetingDocuments)
        .where(and(eq(meetingDocuments.id, p.previousVersionId), eq(meetingDocuments.tenantId, p.tenantId)))
        .limit(1);
      if (prev[0]) versionNum = prev[0].versionNum + 1;
    }

    await tx.insert(meetingDocuments).values({
      id: p.documentId,
      tenantId: p.tenantId,
      meetingId: p.meetingId,
      agendaItemId: p.agendaItemId ?? null,
      fileName: p.fileName,
      mimeType: p.mimeType,
      fileSizeBytes: BigInt(p.sizeBytes),
      storageKey: p.storageKey,
      hash,
      classification,
      documentType: p.documentType ?? null,
      versionNum,
      previousVersionId: p.previousVersionId ?? null,
      retentionYears,
      expiresAt,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await audit(tx, msg, "upload", p.documentId, {
      meetingId: p.meetingId,
      classification,
      versionNum,
    });
  });

  await invalidateDocument(msg.tenantId, p.documentId);
  if (p.previousVersionId) await invalidateDocument(msg.tenantId, p.previousVersionId);
}

// ─── document.remove ─────────────────────────────────────────────────────────

/** document.remove → soft-delete (set `deleted_at`; never a hard delete). */
async function handleDocumentRemove(msg: CommandEnvelope<DocumentRemovePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const rows = await tx
      .select({ id: meetingDocuments.id })
      .from(meetingDocuments)
      .where(
        and(
          eq(meetingDocuments.id, p.documentId),
          eq(meetingDocuments.tenantId, msg.tenantId),
          isNull(meetingDocuments.deletedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new NonRetryableError(`document ${p.documentId} not found (or already removed)`);
    }

    await versionedUpdate(tx, meetingDocuments, {
      id: p.documentId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: { deletedAt: new Date(), updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "meeting_document",
    });

    await audit(tx, msg, "remove", p.documentId, {
      meetingId: p.meetingId,
      ...(p.reason !== undefined ? { reason: p.reason } : {}),
    });
  });

  await invalidateDocument(msg.tenantId, p.documentId);
}

// ─── Agenda-book compilation (Req 4.1, 4.3) ──────────────────────────────────

interface AgendaBookData {
  meeting: { id: string; title: string; meetingNumber: string | null; venue: string | null; scheduledAt: Date | null; status: string };
  items: { sequence: number; title: string; description: string | null; confidentialityLevel: string }[];
  docs: { fileName: string; documentType: string | null; classification: string }[];
}

/** Load everything needed to compile a meeting's agenda book (meeting + accepted items + docs). */
async function loadAgendaBookData(tenantId: string, meetingId: string): Promise<AgendaBookData | null> {
  const meetingRows = await scopedRead((tx) => tx
    .select({
      id: meetings.id,
      title: meetings.title,
      meetingNumber: meetings.meetingNumber,
      venue: meetings.venue,
      scheduledAt: meetings.scheduledAt,
      status: meetings.status,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1));
  const meeting = meetingRows[0];
  if (!meeting) return null;

  const items = await scopedRead((tx) => tx
    .select({
      sequence: agendaItems.sequence,
      title: agendaItems.title,
      description: agendaItems.description,
      confidentialityLevel: agendaItems.confidentialityLevel,
    })
    .from(agendaItems)
    .where(and(eq(agendaItems.meetingId, meetingId), eq(agendaItems.tenantId, tenantId), eq(agendaItems.status, "accepted")))
    .orderBy(asc(agendaItems.sequence)));

  const docs = await scopedRead((tx) => tx
    .select({
      fileName: meetingDocuments.fileName,
      documentType: meetingDocuments.documentType,
      classification: meetingDocuments.classification,
    })
    .from(meetingDocuments)
    .where(and(eq(meetingDocuments.meetingId, meetingId), eq(meetingDocuments.tenantId, tenantId), isNull(meetingDocuments.deletedAt)))
    .orderBy(asc(meetingDocuments.createdAt)));

  return { meeting, items, docs };
}

/** Highest classification across the meeting's agenda items + documents (drives the footer). */
function highestClassification(data: AgendaBookData): Classification {
  let rank = rankOf("internal");
  let label: Classification = "internal";
  const consider = (c: string) => {
    const r = rankOf(c);
    if (r > rank) {
      rank = r;
      label = (CLASSIFICATIONS as readonly string[]).includes(c) ? (c as Classification) : label;
    }
  };
  for (const it of data.items) consider(it.confidentialityLevel);
  for (const d of data.docs) consider(d.classification);
  return label;
}

/** HTML-escape a string for safe inclusion in the rendered agenda-book body. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Compile the paginated agenda-book HTML (Req 4.1, 4.3): cover page, table of contents,
 * agenda items, and the supporting-document index, with a per-page classification footer
 * and a watermark (the recipient identity when circulating, else the classification label).
 */
function compileAgendaBookHtml(data: AgendaBookData, opts: { classification: Classification; watermark: string }): string {
  const classLabel = opts.classification.toUpperCase().replace("_", " ");
  const when = data.meeting.scheduledAt ? data.meeting.scheduledAt.toISOString() : "TBD";
  const toc = data.items.map((i) => `<li>Item ${i.sequence}: ${esc(i.title)}</li>`).join("");
  const body = data.items
    .map(
      (i) =>
        `<section class="item"><h2>Item ${i.sequence}: ${esc(i.title)}</h2><p>${esc(i.description ?? "")}</p></section>`,
    )
    .join("");
  const docList = data.docs.map((d) => `<li>${esc(d.fileName)} (${esc(d.documentType ?? "document")})</li>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:sans-serif;color:#111}
    .footer{position:fixed;bottom:0;width:100%;text-align:center;font-size:10px;color:#666}
    .watermark{position:fixed;top:45%;left:0;width:100%;text-align:center;font-size:48px;color:rgba(200,0,0,0.12);transform:rotate(-30deg)}
    .cover{page-break-after:always}.item{page-break-inside:avoid}
  </style></head><body>
    <div class="watermark">${esc(opts.watermark)}</div>
    <div class="cover">
      <h1>${esc(data.meeting.title)}</h1>
      <p>Meeting No: ${esc(data.meeting.meetingNumber ?? "—")}</p>
      <p>Date/Time: ${esc(when)}</p>
      <p>Venue: ${esc(data.meeting.venue ?? "—")}</p>
      <p>Classification: ${esc(classLabel)}</p>
    </div>
    <h2>Table of Contents</h2><ol>${toc}</ol>
    ${body}
    <h2>Supporting Documents</h2><ul>${docList}</ul>
    <div class="footer">${esc(classLabel)} — compiled by ${esc(SERVICE)}</div>
  </body></html>`;
}

/** Render + store an agenda-book PDF, returning the storage key + content hash. */
async function renderAndStoreBook(
  tenantId: string,
  agendaBookId: string,
  suffix: string,
  html: string,
): Promise<{ storageKey: string; hash: string; sizeBytes: number }> {
  const { buffer } = await renderPdf({ html });
  const storageKey = `meeting/${tenantId}/agenda-books/${agendaBookId}${suffix}.pdf`;
  await storage.putObject(storageKey, buffer, AGENDA_BOOK_MIME);
  return { storageKey, hash: createHash("sha256").update(buffer).digest("hex"), sizeBytes: buffer.length };
}

/**
 * agenda_book.generate → compile the paginated agenda-book PDF (aggregating agenda items +
 * documents), store it, and INSERT the agenda-book document row + emit `agenda_book.generated`.
 */
async function handleAgendaBookGenerate(msg: CommandEnvelope<AgendaBookGeneratePayload>): Promise<void> {
  const p = msg.payload;

  const data = await loadAgendaBookData(p.tenantId, p.meetingId);
  if (!data) throw new NonRetryableError(`agenda book generate: meeting ${p.meetingId} not found`);

  const classification = highestClassification(data);
  const html = compileAgendaBookHtml(data, { classification, watermark: classification.toUpperCase().replace("_", " ") });
  const { storageKey, hash, sizeBytes } = await renderAndStoreBook(p.tenantId, p.agendaBookId, "", html);

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    await tx.insert(meetingDocuments).values({
      id: p.agendaBookId,
      tenantId: p.tenantId,
      meetingId: p.meetingId,
      fileName: `agenda-book-${data.meeting.meetingNumber ?? p.meetingId}.pdf`,
      mimeType: AGENDA_BOOK_MIME,
      fileSizeBytes: BigInt(sizeBytes),
      storageKey,
      hash,
      classification,
      documentType: "agenda_book",
      versionNum: 1,
      retentionYears: 5,
      expiresAt: computeExpiresAt(5, new Date()),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.agendaBookGenerated,
      eventType: EVENTS.agendaBookGenerated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, agendaBookId: p.agendaBookId, storageKey },
    });
    await audit(tx, msg, "agenda_book_generate", p.agendaBookId, { meetingId: p.meetingId, classification });
  });

  await invalidateDocument(msg.tenantId, p.agendaBookId);
}

/**
 * agenda_book.circulate → render a PER-RECIPIENT watermarked copy for each recipient
 * (Req 4.3) and notify each via notification-service (Req 4.4), then emit
 * `agenda_book.circulated`. Recipients are the explicit `recipientIds`; resolving the full
 * confirmed-participant set is owned by the participant module and out of scope here.
 */
async function handleAgendaBookCirculate(msg: CommandEnvelope<AgendaBookCirculatePayload>): Promise<void> {
  const p = msg.payload;
  const recipientIds = p.recipientIds ?? [];

  // The book must have been generated first (its metadata row anchors the circulation).
  const bookRows = await scopedRead((tx) => tx
    .select({ id: meetingDocuments.id, classification: meetingDocuments.classification })
    .from(meetingDocuments)
    .where(
      and(
        eq(meetingDocuments.id, p.agendaBookId),
        eq(meetingDocuments.tenantId, p.tenantId),
        isNull(meetingDocuments.deletedAt),
      ),
    )
    .limit(1));
  const book = bookRows[0];
  if (!book) throw new NonRetryableError(`agenda book circulate: book ${p.agendaBookId} not generated`);

  // Per-recipient watermarked copies (Req 4.3). Rendered/stored before the transaction.
  if (recipientIds.length > 0) {
    const data = await loadAgendaBookData(p.tenantId, p.meetingId);
    if (data) {
      const classification = highestClassification(data);
      for (const recipientId of recipientIds) {
        const html = compileAgendaBookHtml(data, { classification, watermark: recipientId });
        await renderAndStoreBook(p.tenantId, p.agendaBookId, `-${recipientId}`, html);
      }
    }
  }

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    for (const recipientId of recipientIds) {
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.agendaBookCirculated,
          recipient: recipientId,
          recipientId,
          channel: "in_app",
          variables: { meetingId: p.meetingId, agendaBookId: p.agendaBookId },
        }),
      });
    }

    await enqueue(tx, {
      topic: EVENTS.agendaBookCirculated,
      eventType: EVENTS.agendaBookCirculated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, agendaBookId: p.agendaBookId, recipientIds },
    });
    await audit(tx, msg, "agenda_book_circulate", p.agendaBookId, {
      meetingId: p.meetingId,
      recipientCount: recipientIds.length,
    });
  });

  await invalidateDocument(msg.tenantId, p.agendaBookId);
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every document command handler + the agenda-book compilation handlers. worker.ts
 * (task 19.1) calls this with its `registerConsumer`. The agenda module publishes the
 * `agenda_book.*` commands (its routes); the document module owns their consumer side.
 */
export function registerDocumentConsumers(register: RegisterConsumer): void {
  register(COMMANDS.documentUpload, handleDocumentUpload);
  register(COMMANDS.documentRemove, handleDocumentRemove);
  register(COMMANDS.agendaBookGenerate, handleAgendaBookGenerate);
  register(COMMANDS.agendaBookCirculate, handleAgendaBookCirculate);
}
