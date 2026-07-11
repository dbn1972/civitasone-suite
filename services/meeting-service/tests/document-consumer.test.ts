/**
 * document module — consumer integration tests (task 16.1) against the real DB.
 *
 * Exercises the document command handlers end-to-end against Postgres inside
 * `runWithTenant(TENANT, …)` (sets the `app.tenant_id` GUC for RLS, exactly as the worker does
 * via `withTenantConsumer`). Object storage (@civitasone/storage) is mocked so `getObject`
 * returns deterministic bytes and no LocalStack/MinIO is required.
 *
 * Focus (per task 16.1):
 *   • document.upload  — INSERT metadata, SHA-256 content hash, version resolution (Req 15.2, 15.4)
 *   • idempotency (P30) — processing the SAME messageId twice yields exactly one row
 *   • server-side MIME re-validation — a byte/MIME mismatch is a permanent (DLQ) rejection (Req 15.1)
 *   • document.remove  — soft-delete (sets deleted_at; never a hard delete) (Req 4.5)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

// getObject returns a valid PDF by default; individual tests override per storage key via a map.
const objects = new Map<string, Buffer>();
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async (key: string, body: Buffer) => {
    objects.set(key, body);
  }),
  getObject: vi.fn(async (key: string) => objects.get(key) ?? Buffer.from("%PDF-1.4 default", "utf8")),
  deleteObject: vi.fn(async (key: string) => {
    objects.delete(key);
  }),
  presignedGetUrl: vi.fn(async () => "https://s3.mock/presigned"),
}));

import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerDocumentConsumers } from "../src/modules/document/consumer.js";

const TENANT = "a7a7a7a7-0000-4000-8000-0000000000e1";
const ACTOR = "90000000-0000-4000-8000-0000000000e1";
const MEETING = "b7b7b7b7-0000-4000-8000-0000000000e1";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerDocumentConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}

function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

async function readDoc(id: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, hash, version_num, classification, deleted_at, version
                 from meeting.meeting_documents where id = ${id}`;
    });
    return rows[0] ?? null;
  });
}

/** Stage bytes into the mocked object store under the key the upload payload will reference. */
function stage(key: string, body: Buffer): void {
  objects.set(key, body);
}

/** Count outbox messages emitted for a topic under the test tenant. */
async function outboxCount(topic: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`;
    }),
  );
  return rows[0].n as number;
}

/** Read an agenda-book document row (includes document_type) for assertions. */
async function readBook(id: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, document_type, classification from meeting.meeting_documents where id = ${id}`;
    });
    return rows[0] ?? null;
  });
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, meeting_number, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Doc Consumer', 'scheduled', 'MTG/2025-26/001', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    // An accepted agenda item so the agenda-book compilation has content to aggregate.
    await sql`
      insert into meeting.agenda_items
        (id, tenant_id, meeting_id, sequence, title, description, outcome_type, status,
         confidentiality_level, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, ${MEETING}, 1, 'Adopt budget', 'FY budget approval',
              'decision', 'accepted', 'confidential', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.meeting_documents where tenant_id = ${TENANT}`;
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("document.upload", () => {
  it("inserts metadata with a SHA-256 content hash and is idempotent on redelivery (P30)", async () => {
    const documentId = randomUUID();
    const storageKey = `meeting/${TENANT}/documents/${documentId}`;
    const bytes = Buffer.from("%PDF-1.4\nreal content\n", "utf8");
    stage(storageKey, bytes);

    const m = msg(COMMANDS.documentUpload, {
      documentId,
      tenantId: TENANT,
      meetingId: MEETING,
      fileName: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      storageKey,
      classification: "internal",
    });

    await run(m);
    const row = await readDoc(documentId);
    expect(row).toBeTruthy();
    expect(row.hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(row.version_num).toBe(1);

    // Redelivery with the SAME messageId is a no-op (markProcessed skip) — still exactly one row.
    await run(m);
    const count = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select count(*)::int as n from meeting.meeting_documents where id = ${documentId}`;
      }),
    );
    expect(count[0].n).toBe(1);
  });

  it("resolves version_num = predecessor + 1 when replacing a previous version (Req 15.4)", async () => {
    const v1 = randomUUID();
    const v1Key = `meeting/${TENANT}/documents/${v1}`;
    stage(v1Key, Buffer.from("%PDF-1.4 v1", "utf8"));
    await run(msg(COMMANDS.documentUpload, {
      documentId: v1, tenantId: TENANT, meetingId: MEETING, fileName: "a.pdf",
      mimeType: "application/pdf", sizeBytes: 10, storageKey: v1Key, classification: "internal",
    }));

    const v2 = randomUUID();
    const v2Key = `meeting/${TENANT}/documents/${v2}`;
    stage(v2Key, Buffer.from("%PDF-1.4 v2", "utf8"));
    await run(msg(COMMANDS.documentUpload, {
      documentId: v2, tenantId: TENANT, meetingId: MEETING, fileName: "a.pdf",
      mimeType: "application/pdf", sizeBytes: 10, storageKey: v2Key, classification: "internal",
      previousVersionId: v1,
    }));

    expect((await readDoc(v2)).version_num).toBe(2);
  });

  it("rejects a byte/MIME mismatch as a permanent (DLQ) error and inserts nothing (Req 15.1)", async () => {
    const documentId = randomUUID();
    const storageKey = `meeting/${TENANT}/documents/${documentId}`;
    // Declared application/pdf + .pdf name, but the bytes are a PNG signature → content_mismatch.
    stage(storageKey, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const m = msg(COMMANDS.documentUpload, {
      documentId, tenantId: TENANT, meetingId: MEETING, fileName: "report.pdf",
      mimeType: "application/pdf", sizeBytes: 8, storageKey, classification: "internal",
    });

    await expect(run(m)).rejects.toBeInstanceOf(NonRetryableError);
    expect(await readDoc(documentId)).toBeNull();
  });
});

describe("document.remove", () => {
  it("soft-deletes the document (sets deleted_at; row is preserved)", async () => {
    const documentId = randomUUID();
    const storageKey = `meeting/${TENANT}/documents/${documentId}`;
    stage(storageKey, Buffer.from("%PDF-1.4 to-remove", "utf8"));
    await run(msg(COMMANDS.documentUpload, {
      documentId, tenantId: TENANT, meetingId: MEETING, fileName: "gone.pdf",
      mimeType: "application/pdf", sizeBytes: 10, storageKey, classification: "internal",
    }));

    await run(msg(COMMANDS.documentRemove, { documentId, meetingId: MEETING, version: 1 }));

    const row = await readDoc(documentId);
    expect(row).toBeTruthy(); // still present (soft delete)
    expect(row.deleted_at).not.toBeNull();
  });

  it("rejects removing an unknown document as a permanent (DLQ) error", async () => {
    await expect(
      run(msg(COMMANDS.documentRemove, { documentId: randomUUID(), meetingId: MEETING, version: 1 })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("agenda_book.generate", () => {
  it("compiles + stores a paginated agenda-book PDF and inserts its metadata row", async () => {
    const agendaBookId = randomUUID();
    await run(msg(COMMANDS.agendaBookGenerate, { tenantId: TENANT, meetingId: MEETING, agendaBookId }));

    const row = await readBook(agendaBookId);
    expect(row).toBeTruthy();
    expect(row.document_type).toBe("agenda_book");
    // Highest classification across items/docs drives the footer — confidential agenda item wins.
    expect(row.classification).toBe("confidential");
    // The PDF was staged to object storage under the agenda-book key.
    expect(objects.has(`meeting/${TENANT}/agenda-books/${agendaBookId}.pdf`)).toBe(true);
    expect(await outboxCount(EVENTS.agendaBookGenerated)).toBeGreaterThan(0);
  });

  it("rejects generate for an unknown meeting (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.agendaBookGenerate, { tenantId: TENANT, meetingId: randomUUID(), agendaBookId: randomUUID() })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("agenda_book.circulate", () => {
  it("renders per-recipient watermarked copies and fans out notifications", async () => {
    const agendaBookId = randomUUID();
    await run(msg(COMMANDS.agendaBookGenerate, { tenantId: TENANT, meetingId: MEETING, agendaBookId }));

    const recipientId = randomUUID();
    const before = await outboxCount(EVENTS.agendaBookCirculated);
    await run(msg(COMMANDS.agendaBookCirculate, { tenantId: TENANT, meetingId: MEETING, agendaBookId, recipientIds: [recipientId] }));

    // A per-recipient watermarked copy was rendered + stored (Req 4.3).
    expect(objects.has(`meeting/${TENANT}/agenda-books/${agendaBookId}-${recipientId}.pdf`)).toBe(true);
    // The circulation event was emitted (Req 4.4).
    expect(await outboxCount(EVENTS.agendaBookCirculated)).toBe(before + 1);
  });

  it("rejects circulate before the book is generated (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.agendaBookCirculate, { tenantId: TENANT, meetingId: MEETING, agendaBookId: randomUUID(), recipientIds: [] })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
