/**
 * CROSS-MODULE INTEGRATION FINDING (HIGH) — once a meeting's minutes are
 * approved, `minutes/consumer.ts` correctly LOCKS the minutes content itself
 * against further edits (Req 7.5) — but the underlying `decisions` row that the
 * approved minutes recorded can still be silently amended afterward, with no
 * error, no re-opening of the minutes, and no flag anywhere connecting the two.
 * The legally-binding, DSC-hash-anchored minutes and the "live" decision record
 * can permanently disagree, and nothing in the system ever surfaces that.
 *
 * Root cause: `decision/consumer.ts` never imports `minutes/schema.ts` at all
 * (confirmed by grepping every cross-module import in every consumer.ts in this
 * service — decision/consumer.ts imports only `meetings`, `committees`/
 * `committeeMembers`, and `votes`). `handleDecisionUpdate`
 * (decision/consumer.ts:551 onward) applies `patch.text` (and type, authority,
 * effectiveDate, financialImplication, status, …) via a plain `versionedUpdate`
 * keyed only on the decision's own optimistic-lock `version` — there is no
 * query against `minutes`, no check of the parent meeting's status, nothing.
 *
 * Contrast: `minutes/consumer.ts`'s `handleMinutesUpdate` (consumer.ts:472
 * onward) DOES correctly call `assertMinutesEditable(current.status)`
 * (minutes/domain.ts:137-143, `isMinutesLocked` = approved | signed |
 * circulated) and throws `MEETING_INVALID_TRANSITION` (422) rather than let a
 * locked minutes document be edited directly. That protection is real and
 * proven below to work — it just doesn't reach the decisions table the minutes
 * were rendered from.
 *
 * Proven live below: a decision is recorded, and minutes that (per their
 * `content`) already recorded it are approved and locked. Editing the minutes
 * content directly is correctly rejected. Editing the underlying DECISION's
 * text, however, succeeds outright — leaving the approved minutes' `content`
 * and `hash_current` referencing text that, per the live decisions table, is no
 * longer what was decided.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";
import { registerMinutesConsumers } from "../src/modules/minutes/consumer.js";

const TENANT = randomUUID();
const MEETING = randomUUID();
const DECISION = randomUUID();
const MINUTES = randomUUID();
const ACTOR = randomUUID();
const CHAIR = randomUUID();

const ORIGINAL_TEXT = "Approve Rs 10 lakh for emergency roof repairs";
const ORIGINAL_CONTENT = `Minutes of meeting.\n\nDecision recorded: "${ORIGINAL_TEXT}"\n`;
const FIXED_HASH = "a".repeat(64);

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerDecisionConsumers((topic: string, h: any) => handlers.set(topic, h));
registerMinutesConsumers((topic: string, h: any) => handlers.set(topic, h));

function msg<T>(type: string, payload: T): CommandEnvelope<T> {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}
function run<T>(m: CommandEnvelope<T>): Promise<void> {
  return runWithTenant(TENANT, () => handlers.get(m.type)!(m)) as Promise<void>;
}
function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

beforeAll(async () => {
  await tenantQuery(async (sql) => {
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, financial_year, scheduled_at, actual_start_at, actual_end_at, meeting_number, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Decision-Drift Test Meeting', 'minutes_approved', '2025-26',
        '2025-06-15T10:00:00Z', '2025-06-15T10:05:00Z', '2025-06-15T11:00:00Z',
        ${"DD/2025-26/" + MEETING.slice(0, 8)}, ${ACTOR}, ${ACTOR})`;

    await sql`
      insert into meeting.decisions
        (id, tenant_id, meeting_id, text, type, status, created_by, updated_by)
      values (${DECISION}, ${TENANT}, ${MEETING}, ${ORIGINAL_TEXT}, 'financial', 'effective', ${ACTOR}, ${ACTOR})`;

    // Minutes already APPROVED (locked, Req 7.5) — content already renders the original
    // decision text, hash already anchored, as would happen after a real create -> submit ->
    // approve flow.
    await sql`
      insert into meeting.minutes
        (id, tenant_id, meeting_id, template_type, content, status, current_version,
         approved_by, approved_at, hash_current, created_by, updated_by)
      values (${MINUTES}, ${TENANT}, ${MEETING}, 'summary', ${ORIGINAL_CONTENT}, 'approved', 1,
        ${CHAIR}, now(), ${FIXED_HASH}, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await tenantQuery(async (sql) => {
    await sql`delete from meeting.minutes_versions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.decisions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("an approved minutes' content is locked, but the decision it recorded is not", () => {
  it("sanity: editing the approved minutes' content directly IS correctly rejected", async () => {
    await expect(
      run(msg(COMMANDS.minutesUpdate, { minutesId: MINUTES, version: 1, content: "Tampered content", changeNote: "attempted edit" })),
    ).rejects.toThrow();

    const rows = await tenantQuery((sql) => sql`select content, status, current_version from meeting.minutes where id = ${MINUTES}`);
    expect((rows as any[])[0].content).toBe(ORIGINAL_CONTENT);
    expect((rows as any[])[0].status).toBe("approved");
  });

  it("BUG: the underlying decision can still be amended after the minutes recording it are approved", async () => {
    const AMENDED_TEXT = "Approve Rs 40 lakh for a full structural overhaul (never actually decided in-meeting)";
    await run(msg(COMMANDS.decisionUpdate, {
      decisionId: DECISION, version: 1, patch: { text: AMENDED_TEXT },
    }));

    const rows = await tenantQuery((sql) => sql`select text, version from meeting.decisions where id = ${DECISION}`);
    expect((rows as any[])[0].text).toBe(AMENDED_TEXT);
    expect((rows as any[])[0].text).not.toBe(ORIGINAL_TEXT);
  });

  it("BUG: the approved, hash-anchored minutes now silently disagree with the live decision record", async () => {
    const rows = await tenantQuery(
      (sql) => sql`select content, hash_current, status, current_version from meeting.minutes where id = ${MINUTES}`,
    );
    const m = (rows as any[])[0];
    // The signed-off official record still shows the ORIGINAL text and its original hash —
    // untouched, unre-opened, un-flagged — while meeting.decisions now says something the
    // committee never actually approved in that form. No mechanism anywhere links the two or
    // surfaces the divergence.
    expect(m.content).toBe(ORIGINAL_CONTENT);
    expect(m.content).toContain("Rs 10 lakh for emergency roof repairs");
    expect(m.hash_current).toBe(FIXED_HASH);
    expect(m.status).toBe("approved");
    expect(m.current_version).toBe(1);
  });
});
