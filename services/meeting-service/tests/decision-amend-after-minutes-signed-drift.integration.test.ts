/**
 * CROSS-MODULE INTEGRATION FIX (was HIGH) — once a meeting's minutes are
 * approved, `minutes/consumer.ts` has always correctly LOCKED the minutes
 * content itself against further edits (Req 7.5). `decision/consumer.ts`'s
 * `handleDecisionUpdate` now applies the same lock from the decision side:
 * it looks up the parent meeting's minutes status and rejects the patch via
 * `isMinutesLocked` (minutes/domain.ts) when minutes are approved/signed/
 * circulated — mirroring `handleMinutesUpdate`'s own `assertMinutesEditable`
 * guard. Before this fix, `decision/consumer.ts` never imported
 * `minutes/schema.ts` at all, so a decision could be silently amended after
 * the minutes recording it were already signed off, leaving the legally-
 * binding, hash-anchored minutes permanently disagreeing with the live
 * decision record.
 *
 * Proven live below: a decision is recorded, and minutes that (per their
 * `content`) already recorded it are approved and locked. Editing the minutes
 * content directly is correctly rejected (unchanged behavior). Editing the
 * underlying DECISION's text is now ALSO correctly rejected, and the decision
 * row is confirmed unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
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

// Gap 3 fixtures: supersession normally happens at a LATER meeting. LATER_MEETING is NOT
// minutes-locked and holds the forward supersession targets.
const LATER_MEETING = randomUUID();
const SUPERSEDER = randomUUID(); // a real, later decision the locked DECISION may point to (acyclic)
// Cycle fixtures: DEC_CYCLE lives in the LOCKED meeting; DEC_CYCLE_TARGET already points back at it,
// so a supersede-only patch DEC_CYCLE → DEC_CYCLE_TARGET would close a 2-cycle in the register.
const DEC_CYCLE = randomUUID();
const DEC_CYCLE_TARGET = randomUUID();

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

    // ── Gap 3 fixtures ──────────────────────────────────────────────────────────────────────
    // A LATER meeting with NO minutes lock, holding the forward supersession targets.
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, financial_year, scheduled_at, meeting_number, created_by, updated_by)
      values (${LATER_MEETING}, ${TENANT}, 'committee', 'Later Decision Meeting', 'in_progress', '2025-26',
        '2025-09-15T10:00:00Z', ${"DD/2025-26/" + LATER_MEETING.slice(0, 8)}, ${ACTOR}, ${ACTOR})`;

    // A real later decision that the locked DECISION may legitimately be superseded BY (acyclic).
    await sql`
      insert into meeting.decisions (id, tenant_id, meeting_id, text, type, status, created_by, updated_by)
      values (${SUPERSEDER}, ${TENANT}, ${LATER_MEETING}, 'Later decision superseding the roof-repair sanction',
        'financial', 'effective', ${ACTOR}, ${ACTOR})`;

    // Cycle setup: DEC_CYCLE sits inside the LOCKED meeting; DEC_CYCLE_TARGET already supersedes it,
    // so a supersede-only patch DEC_CYCLE → DEC_CYCLE_TARGET would close a 2-cycle in the register.
    await sql`
      insert into meeting.decisions (id, tenant_id, meeting_id, text, type, status, created_by, updated_by)
      values (${DEC_CYCLE}, ${TENANT}, ${MEETING}, 'A minuted decision used by the lineage-cycle case',
        'administrative', 'effective', ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.decisions (id, tenant_id, meeting_id, text, type, status, superseded_by_id, created_by, updated_by)
      values (${DEC_CYCLE_TARGET}, ${TENANT}, ${LATER_MEETING}, 'Already superseded by DEC_CYCLE',
        'administrative', 'effective', ${DEC_CYCLE}, ${ACTOR}, ${ACTOR})`;
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

describe("an approved minutes' content is locked, and so is the decision it recorded", () => {
  it("sanity: editing the approved minutes' content directly IS correctly rejected", async () => {
    await expect(
      run(msg(COMMANDS.minutesUpdate, { minutesId: MINUTES, version: 1, content: "Tampered content", changeNote: "attempted edit" })),
    ).rejects.toThrow();

    const rows = await tenantQuery((sql) => sql`select content, status, current_version from meeting.minutes where id = ${MINUTES}`);
    expect((rows as any[])[0].content).toBe(ORIGINAL_CONTENT);
    expect((rows as any[])[0].status).toBe("approved");
  });

  it("FIXED: the underlying decision can no longer be amended once the minutes recording it are approved", async () => {
    const AMENDED_TEXT = "Approve Rs 40 lakh for a full structural overhaul (never actually decided in-meeting)";
    await expect(
      run(msg(COMMANDS.decisionUpdate, {
        decisionId: DECISION, version: 1, patch: { text: AMENDED_TEXT },
      })),
    ).rejects.toThrow(/minutes are already approved/);

    // The decision row is untouched — no drift between it and the signed-off minutes.
    const rows = await tenantQuery((sql) => sql`select text, version from meeting.decisions where id = ${DECISION}`);
    expect((rows as any[])[0].text).toBe(ORIGINAL_TEXT);
    expect((rows as any[])[0].text).not.toBe(AMENDED_TEXT);
    expect((rows as any[])[0].version).toBe(1);
  });
});

describe("[FIXED, Gap 3] a supersede-only patch survives the minutes lock, but substance stays locked", () => {
  it("still BLOCKS a patch that mixes a substantive field (text) in with the supersession, once minutes are locked", async () => {
    // Supersession fields are present, but so is `text` — a substantive rewrite of a minuted
    // decision, which must stay blocked exactly as a plain text patch is. The exemption is narrow.
    await expect(
      run(msg(COMMANDS.decisionUpdate, {
        decisionId: DECISION,
        version: 1,
        patch: { status: "superseded", supersededById: SUPERSEDER, text: "Sneak a rewrite in under cover of a supersession" },
      })),
    ).rejects.toThrow(/minutes are already approved/);

    const rows = await tenantQuery((sql) => sql`select text, status, superseded_by_id, version from meeting.decisions where id = ${DECISION}`);
    expect((rows as any[])[0].text).toBe(ORIGINAL_TEXT);
    expect((rows as any[])[0].status).toBe("effective");
    expect((rows as any[])[0].superseded_by_id).toBeNull();
    expect((rows as any[])[0].version).toBe(1);
  });

  it("still runs fix 9's acyclic-lineage guard on the supersede path even when minutes are locked (rejects a cycle, NOT via the minutes gate)", async () => {
    // DEC_CYCLE is inside the LOCKED meeting; DEC_CYCLE_TARGET already supersedes it. A supersede-
    // only patch closing the loop must be rejected by assertAcyclicLineage — proving the exemption
    // lifts ONLY the minutes-lock gate, not fix 9's integrity checks.
    let caught: unknown;
    await run(msg(COMMANDS.decisionUpdate, {
      decisionId: DEC_CYCLE,
      version: 1,
      patch: { status: "superseded", supersededById: DEC_CYCLE_TARGET },
    })).catch((e) => {
      caught = e;
    });

    expect(caught).toBeInstanceOf(NonRetryableError);
    expect((caught as Error).message).toMatch(/cycle/i);
    // Crucially NOT rejected by the minutes-lock gate — the supersede path was reached.
    expect((caught as Error).message).not.toMatch(/minutes are already approved/);

    // DEC_CYCLE is untouched — the cycle was refused.
    const rows = await tenantQuery((sql) => sql`select status, superseded_by_id from meeting.decisions where id = ${DEC_CYCLE}`);
    expect((rows as any[])[0].status).toBe("effective");
    expect((rows as any[])[0].superseded_by_id).toBeNull();
  });

  it("ALLOWS a supersede-only patch (status=superseded + supersededById → a real decision) even though the minutes are locked", async () => {
    // The core Gap 3 fix: superseding a minuted decision at a later meeting adds a forward pointer
    // without rewriting the minuted substance, so it must NOT be permanently blocked by the lock.
    await run(msg(COMMANDS.decisionUpdate, {
      decisionId: DECISION,
      version: 1,
      patch: { status: "superseded", supersededById: SUPERSEDER },
    }));

    const rows = await tenantQuery((sql) => sql`select text, status, superseded_by_id, version from meeting.decisions where id = ${DECISION}`);
    // Forward supersession pointer recorded...
    expect((rows as any[])[0].status).toBe("superseded");
    expect((rows as any[])[0].superseded_by_id).toBe(SUPERSEDER);
    expect((rows as any[])[0].version).toBe(2);
    // ...and the minuted SUBSTANCE is untouched — no drift with the signed-off minutes.
    expect((rows as any[])[0].text).toBe(ORIGINAL_TEXT);
  });
});
