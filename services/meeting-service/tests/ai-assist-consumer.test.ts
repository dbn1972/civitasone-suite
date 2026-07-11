/**
 * AI-assist module — consumer integration tests (task 17.1) against the real DB.
 *
 * Exercises the three AI command handlers end-to-end against Postgres inside
 * `runWithTenant(TENANT, …)` (sets the `app.tenant_id` GUC for RLS exactly as the worker does).
 * Object storage (@civitasone/storage) is mocked with an in-memory map so no LocalStack/MinIO is
 * required; the heuristic AI provider runs offline and deterministically.
 *
 * The two safety invariants are asserted at the persistence boundary (they cannot be bypassed):
 *   - Confidence gate (Req 16.6): confidence ≥ 0.70 stores the transcript; below → manual
 *     fallback + compliance alert, and NOTHING is persisted.
 *   - Human-approval "AI never auto-publishes" (Req 16.5, P37): AI minutes are written as an
 *     editable `draft` with `ai_generated = true` (never approved/signed/circulated), an already
 *     human-authorised minutes is never overwritten, and extracted actions are stored only as a
 *     `ai_action_suggestions` (pending-confirmation) artifact — never live action items.
 *   - Graceful degradation (Req 16.6): an unavailable provider / missing recording degrades to
 *     the manual workflow (notify + compliance alert) and ACKs — it never throws / dead-letters.
 *
 * _Requirements: 7.2, 16.1, 16.2, 16.3, 16.5, 16.6_
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// In-memory object store. getObject throws for an unstaged key (drives the "recording
// unavailable" branch); putObject captures written artifacts (transcript / action candidates).
const objects = new Map<string, Buffer>();
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async (key: string, body: Buffer | string) => {
    objects.set(key, typeof body === "string" ? Buffer.from(body, "utf8") : body);
  }),
  getObject: vi.fn(async (key: string) => {
    const v = objects.get(key);
    if (!v) throw new Error(`no object at ${key}`);
    return v;
  }),
  deleteObject: vi.fn(async (key: string) => {
    objects.delete(key);
  }),
  presignedGetUrl: vi.fn(async () => "https://s3.mock/presigned"),
}));

import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerAiAssistConsumers } from "../src/modules/ai-assist/consumer.js";
import { transcriptStorageKey } from "../src/modules/ai-assist/domain.js";

const TENANT = "a5a5a5a5-0000-4000-8000-0000000017c0";
const ACTOR = "90000000-0000-4000-8000-0000000017c0";
const SECRETARY = "5ec00000-0000-4000-8000-0000000017c0";
const COMMITTEE = "c0c0c0c0-0000-4000-8000-0000000017c0";

// One meeting per scenario keeps the DB assertions independent.
const M_OK = "b0000000-0000-4000-8000-0000000017c0"; // transcribe high-confidence
const M_LOW = "b0000000-0000-4000-8000-0000000017c1"; // transcribe low-confidence
const M_UNAVAIL = "b0000000-0000-4000-8000-0000000017c2"; // transcribe AI unavailable
const M_NOREC = "b0000000-0000-4000-8000-0000000017c3"; // transcribe recording missing
const M_DRAFT = "b0000000-0000-4000-8000-0000000017c4"; // draft-minutes happy
const M_NOTRANS = "b0000000-0000-4000-8000-0000000017c5"; // draft/extract, no transcript
const M_APPROVED = "b0000000-0000-4000-8000-0000000017c6"; // draft-minutes over approved minutes
const M_EXTRACT = "b0000000-0000-4000-8000-0000000017c7"; // extract-actions happy

const ALL_MEETINGS = [M_OK, M_LOW, M_UNAVAIL, M_NOREC, M_DRAFT, M_NOTRANS, M_APPROVED, M_EXTRACT];

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerAiAssistConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T): CommandEnvelope<T> {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}
function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

/** Count meeting_documents of a given document_type for a meeting. */
async function docCount(meetingId: string, documentType: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from meeting.meeting_documents
                 where tenant_id = ${TENANT} and meeting_id = ${meetingId} and document_type = ${documentType}`;
    }),
  );
  return rows[0].n as number;
}

/** Read the (single) minutes row for a meeting. */
async function readMinutes(meetingId: string): Promise<any | null> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, status, content, ai_generated, current_version
                 from meeting.minutes where tenant_id = ${TENANT} and meeting_id = ${meetingId}`;
    }),
  );
  return rows[0] ?? null;
}

/** Count outbox rows on a topic emitted for this tenant since the test started. */
async function outboxCount(topic: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`;
    }),
  );
  return rows[0].n as number;
}

/** Seed a stored transcript artifact (meeting_documents row + staged object bytes). */
async function seedTranscript(meetingId: string, text: string): Promise<void> {
  const key = `ai/transcripts/${TENANT}/${meetingId}.txt`;
  objects.set(key, Buffer.from(text, "utf8"));
  await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`
        insert into meeting.meeting_documents
          (id, tenant_id, meeting_id, file_name, mime_type, storage_key, hash, document_type, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${meetingId}, ${"transcript-" + meetingId + ".txt"}, 'text/plain',
                ${key}, ${"a".repeat(64)}, 'transcript', ${ACTOR}, ${ACTOR})`;
    }),
  );
}

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`
        insert into meeting.committees (id, tenant_id, name, type, constitution_date, quorum_rule, created_by, updated_by)
        values (${COMMITTEE}, ${TENANT}, 'AI Committee', 'standing', '2020-01-01', ${sql.json({ minMembers: 2 })}, ${ACTOR}, ${ACTOR})
        on conflict (id) do nothing`;
      for (const id of ALL_MEETINGS) {
        await sql`
          insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, secretary_id, scheduled_at, created_by, updated_by)
          values (${id}, ${TENANT}, 'committee', 'AI Meeting', 'minutes_pending', ${COMMITTEE}, ${SECRETARY}, now(), ${ACTOR}, ${ACTOR})
          on conflict (id) do nothing`;
      }
      // An already human-authorised minutes that the AI path must NOT overwrite (P37).
      await sql`
        insert into meeting.minutes (id, tenant_id, meeting_id, template_type, content, status, current_version, created_by, updated_by, version)
        values (${randomUUID()}, ${TENANT}, ${M_APPROVED}, 'summary', 'ORIGINAL APPROVED CONTENT', 'approved', 1, ${ACTOR}, ${ACTOR}, 1)`;
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`delete from meeting.minutes_versions where tenant_id = ${TENANT}`;
      await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
      await sql`delete from meeting.meeting_documents where tenant_id = ${TENANT}`;
      await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
      await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
      await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
    }),
  );
  await sqlClient.end();
});

describe("ai.transcribe", () => {
  it("stores the transcript + emits transcript_ready when confidence ≥ 0.70", async () => {
    const recordingRef = `recordings/${M_OK}.mp4`;
    objects.set(recordingRef, Buffer.from("fake-audio-bytes"));
    const before = await outboxCount(EVENTS.aiTranscriptReady);

    await run(msg(COMMANDS.aiTranscribe, { meetingId: M_OK, tenantId: TENANT, recordingRef }));

    expect(await docCount(M_OK, "transcript")).toBe(1);
    expect(objects.has(transcriptStorageKey(TENANT, M_OK))).toBe(true);
    expect(await outboxCount(EVENTS.aiTranscriptReady)).toBe(before + 1);
  });

  it("is idempotent on redelivery (same messageId ⇒ one transcript)", async () => {
    const recordingRef = `recordings/${M_OK}-again.mp4`;
    objects.set(recordingRef, Buffer.from("fake-audio-bytes"));
    const m = msg(COMMANDS.aiTranscribe, { meetingId: M_OK, tenantId: TENANT, recordingRef });
    await run(m);
    await run(m); // redelivery — markProcessed skip
    // Still exactly one transcript created by the FIRST test + this test's single insert = 2 total.
    expect(await docCount(M_OK, "transcript")).toBe(2);
  });

  it("routes to manual fallback (no transcript stored) when confidence < 0.70", async () => {
    process.env.AI_STUB_CONFIDENCE = "0.5";
    const recordingRef = `recordings/${M_LOW}.mp4`;
    objects.set(recordingRef, Buffer.from("fake-audio-bytes"));
    const beforeAlerts = await outboxCount(EVENTS.complianceAlert);

    await run(msg(COMMANDS.aiTranscribe, { meetingId: M_LOW, tenantId: TENANT, recordingRef }));

    expect(await docCount(M_LOW, "transcript")).toBe(0); // NOT persisted
    expect(await outboxCount(EVENTS.complianceAlert)).toBeGreaterThan(beforeAlerts);
  });

  it("degrades gracefully (no throw, no transcript) when the AI provider is unavailable", async () => {
    process.env.AI_PROVIDER = "external"; // unconfigured external seam → AIUnavailableError
    const recordingRef = `recordings/${M_UNAVAIL}.mp4`;
    objects.set(recordingRef, Buffer.from("fake-audio-bytes"));

    await expect(run(msg(COMMANDS.aiTranscribe, { meetingId: M_UNAVAIL, tenantId: TENANT, recordingRef }))).resolves.toBeUndefined();
    expect(await docCount(M_UNAVAIL, "transcript")).toBe(0);
  });

  it("degrades gracefully when the recording cannot be fetched", async () => {
    // recordingRef is NOT staged → mocked getObject throws → recording_unavailable branch.
    await expect(
      run(msg(COMMANDS.aiTranscribe, { meetingId: M_NOREC, tenantId: TENANT, recordingRef: `recordings/${M_NOREC}-missing.mp4` })),
    ).resolves.toBeUndefined();
    expect(await docCount(M_NOREC, "transcript")).toBe(0);
  });
});

describe("ai.draft_minutes (human-approval invariant)", () => {
  it("writes an AI minutes DRAFT (ai_generated=true, status=draft) and emits minutes_draft_ready", async () => {
    await seedTranscript(M_DRAFT, "ACTION: @Rao to circulate the draft by Friday\nDiscussed the budget.");
    const before = await outboxCount(EVENTS.aiMinutesDraftReady);

    await run(msg(COMMANDS.aiDraftMinutes, { meetingId: M_DRAFT, tenantId: TENANT }));

    const m = await readMinutes(M_DRAFT);
    expect(m).toBeTruthy();
    expect(m.status).toBe("draft");
    expect(m.ai_generated).toBe(true);
    expect(await outboxCount(EVENTS.aiMinutesDraftReady)).toBe(before + 1);
  });

  it("skips (manual fallback) when there is no transcript", async () => {
    await run(msg(COMMANDS.aiDraftMinutes, { meetingId: M_NOTRANS, tenantId: TENANT }));
    expect(await readMinutes(M_NOTRANS)).toBeNull();
  });

  it("never overwrites an already approved minutes (P37)", async () => {
    await seedTranscript(M_APPROVED, "ACTION: try to overwrite approved minutes");
    await run(msg(COMMANDS.aiDraftMinutes, { meetingId: M_APPROVED, tenantId: TENANT }));

    const m = await readMinutes(M_APPROVED);
    expect(m.status).toBe("approved");
    expect(m.content).toBe("ORIGINAL APPROVED CONTENT"); // untouched
    expect(m.ai_generated).toBe(false);
  });
});

describe("ai.extract_actions (pending confirmation)", () => {
  it("stores an ai_action_suggestions artifact — never live action items", async () => {
    await seedTranscript(M_EXTRACT, "ACTION: @Rao to file the report by Friday\nTODO: prepare next agenda");
    await run(msg(COMMANDS.aiExtractActions, { meetingId: M_EXTRACT, tenantId: TENANT }));

    expect(await docCount(M_EXTRACT, "ai_action_suggestions")).toBe(1);
    // Confirm the stored artifact is marked pending_confirmation (advisory only).
    const key = `ai/action-candidates/${TENANT}/${M_EXTRACT}.json`;
    const stored = objects.get(key);
    expect(stored).toBeTruthy();
    const artifact = JSON.parse(stored!.toString("utf8"));
    expect(artifact.status).toBe("pending_confirmation");
    expect(artifact.aiGenerated).toBe(true);
    expect(artifact.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it("skips when there is no transcript", async () => {
    await run(msg(COMMANDS.aiExtractActions, { meetingId: M_NOTRANS, tenantId: TENANT }));
    expect(await docCount(M_NOTRANS, "ai_action_suggestions")).toBe(0);
  });
});
