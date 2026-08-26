/**
 * document module — `meeting_documents.previous_version_id` has NO foreign-key constraint
 * (schema/migration review finding).
 *
 * migrations/0001_meeting_core.sql (meeting.meeting_documents DDL) declares:
 *   previous_version_id UUID,
 * with no `REFERENCES meeting.meeting_documents(id)` — unlike `meeting_id` and `agenda_item_id`
 * on the SAME table, which both carry real FKs. No later migration (checked 0002-0008) adds one
 * either. Drizzle's schema.ts view (src/modules/document/schema.ts:43) mirrors this: a bare
 * `uuid("previous_version_id")`, no `.references(...)`.
 *
 * Consequence: `document/consumer.ts` `handleDocumentUpload` (:174-182) looks up the named
 * predecessor to compute `versionNum`, but the lookup result is used ONLY for the version
 * number — a miss silently falls back to `versionNum = 1` while STILL persisting the caller's
 * `previousVersionId` verbatim onto the new row (:196-197: `previousVersionId:
 * p.previousVersionId ?? null`). With no DB-level backstop, this produces a `meeting_documents`
 * row that is version 1 (i.e. presents as an original) yet carries a `previous_version_id`
 * pointing at nothing — `document/repo.ts` `getVersionHistory`'s ancestor walk
 * (:143-149 `loadById(tenantId, cursor.previousVersionId)`) hits a miss and silently
 * truncates the chain rather than surfacing the inconsistency.
 *
 * Severity: LOW (data-integrity hygiene, not an access-control bypass — RLS + the
 * classification filter in getDocuments/getVersionHistory are unaffected). Live-proven: the DB
 * itself accepts the dangling reference at the schema level, and the real consumer accepts it
 * end-to-end at the application level.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerDocumentConsumers } from "../src/modules/document/consumer.js";

const TENANT = "a4a4a4a4-0000-4000-8000-0000000c1a58";
const ACTOR = "90000000-0000-4000-8000-0000000c1a58";
const MEETING = "b4b40001-0000-4000-8000-0000000c1a58";
const RAW_INSERT_DOC = "d4d40001-0000-4000-8000-0000000c1a58";
const CONSUMER_DOC = "d4d40002-0000-4000-8000-0000000c1a58";
const NONEXISTENT_PREV_ID = "ffffffff-ffff-4fff-8fff-fffffffffff1";

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

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, scheduled_at, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'FK Gap Test', 'scheduled', now() + interval '1 day', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.meeting_documents where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("schema gap: meeting_documents.previous_version_id has no FK constraint", () => {
  it("the database itself accepts a previous_version_id that names no real row (a raw INSERT, bypassing all app-layer logic, succeeds)", async () => {
    await expect(
      runWithTenant(TENANT, () =>
        sqlClient.begin(async (sql) => {
          await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
          return sql`
            insert into meeting.meeting_documents
              (id, tenant_id, meeting_id, file_name, mime_type, storage_key, hash,
               previous_version_id, created_by, updated_by)
            values (${RAW_INSERT_DOC}, ${TENANT}, ${MEETING}, 'dangling.pdf', 'application/pdf',
                    ${"meeting/" + TENANT + "/documents/" + RAW_INSERT_DOC}, ${"e".repeat(64)},
                    ${NONEXISTENT_PREV_ID}, ${ACTOR}, ${ACTOR})`;
        }),
      ),
    ).resolves.toBeDefined(); // no foreign_key_violation — contrast with meeting_id, which IS FK'd
  });

  it("the real document.upload consumer also accepts a previousVersionId that names no real row — silently resets versionNum to 1 while still persisting the dangling reference", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4 dangling-version-test", "utf8");
    objects.set(`meeting/${TENANT}/documents/${CONSUMER_DOC}`, pdfBytes);

    await run(
      msg(COMMANDS.documentUpload, {
        documentId: CONSUMER_DOC,
        tenantId: TENANT,
        meetingId: MEETING,
        fileName: "dangling-consumer.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdfBytes.length,
        storageKey: `meeting/${TENANT}/documents/${CONSUMER_DOC}`,
        classification: "internal",
        previousVersionId: NONEXISTENT_PREV_ID, // never existed — the consumer's own lookup misses
      }),
    );

    const rows = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select version_num, previous_version_id from meeting.meeting_documents where id = ${CONSUMER_DOC}`;
      }),
    );
    expect(rows[0].version_num).toBe(1); // predecessor lookup missed -> falls back to "first version"
    expect(rows[0].previous_version_id).toBe(NONEXISTENT_PREV_ID); // yet the dangling pointer is kept
  });
});
