/**
 * decision module — consumer integration tests (real DB, no mocks).
 *
 * Exercises the decision/resolution command handlers end-to-end against Postgres. Each handler
 * runs inside `runWithTenant(TENANT, …)` so the `app.tenant_id` GUC is set (RLS) exactly as the
 * worker does via `withTenantConsumer`. Asserts the committed DB effect (INSERT / versioned
 * UPDATE) plus the transactional-outbox events, and covers:
 *
 *   - decision.record → typed ERP fan-out (Req 22.1–22.5): generic `decision.recorded` + the
 *     type-specific event; GFR counter-signature routing (Req 11.7, 20.8) when the financial
 *     implication meets the threshold (workflow_triggered + workflow.instance.create).
 *   - decision.update → optimistic-locked patch + link/supersede back-pointer.
 *   - resolution.record → sequential per-committee-per-FY numbering (P25) + result computation
 *     (Req 11.3, 11.4) + resolution.passed / resolution.rejected.
 *   - resolution.sign → render + (dev unsigned) hash anchor + resolution.signed; only a passed
 *     resolution can be signed (permanent → DLQ).
 *   - resolution.circulation_init → anchor to the committee's meeting + member distribution.
 *   - dissent.record → dissent note attached to the member's vote row / audit annexure (Req 11.6).
 *   - P30 idempotency: re-delivering the same messageId is a no-op (markProcessed skip).
 *
 * _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 12.1, 12.2, 22.1, 22.2, 22.3, 22.4, 22.5_
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";

const TENANT = "a0b8b3e6-dec0-4000-8000-0000000000d0";
const COMMITTEE = "b0b8b3e6-dec0-4000-8000-0000000000d0";
const MEETING = "c0b8b3e6-dec0-4000-8000-0000000000d0"; // committee meeting, FY 2025-26
const MEMBER_A = "d0b8b3e6-dec0-4000-8000-0000000000d1";
const MEMBER_B = "d0b8b3e6-dec0-4000-8000-0000000000d2";
const MEMBER_C = "d0b8b3e6-dec0-4000-8000-0000000000d3";
const ACTOR = "e0b8b3e6-dec0-4000-8000-0000000000d0";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerDecisionConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  } as CommandEnvelope<T>;
}

function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

/** Scoped read helper (sets the RLS GUC like the worker). */
function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

async function readDecision(id: string): Promise<any | null> {
  const rows = await tenantQuery((sql) => sql`select * from meeting.decisions where id = ${id}`);
  return rows[0] ?? null;
}
async function readResolution(id: string): Promise<any | null> {
  const rows = await tenantQuery((sql) => sql`select * from meeting.resolutions where id = ${id}`);
  return rows[0] ?? null;
}
async function outboxCount(topic: string): Promise<number> {
  const rows = await tenantQuery(
    (sql) => sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`,
  );
  return rows[0].n as number;
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.decisions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Finance Committee', 'FC', 'finance', '2025-01-01',
              ${sql.json({ minMembers: 2 })}, ${ACTOR}, ${ACTOR})`;
    for (const m of [MEMBER_A, MEMBER_B, MEMBER_C]) {
      await sql`
        insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;
    }
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Q1 Finance', 'in_progress', ${COMMITTEE}, '2025-26',
              '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.decisions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("decision.record", () => {
  it("inserts an administrative decision and emits only the generic fact; idempotent on redelivery (P30)", async () => {
    const decisionId = randomUUID();
    const before = await outboxCount(EVENTS.decisionRecorded);
    const m = msg(COMMANDS.decisionRecord, {
      decisionId,
      meetingId: MEETING,
      tenantId: TENANT,
      text: "Adopt the revised office timings",
      type: "administrative",
    });
    await run(m);

    const row = await readDecision(decisionId);
    expect(row?.type).toBe("administrative");
    expect(row?.status).toBe("effective");
    expect(row?.workflow_triggered).toBe(false);
    expect(await outboxCount(EVENTS.decisionRecorded)).toBe(before + 1);

    // Redelivery with the SAME messageId is a no-op (markProcessed skip) — still one decision.
    await run(m);
    const cnt = await tenantQuery(
      (sql) => sql`select count(*)::int as n from meeting.decisions where id = ${decisionId}`,
    );
    expect(cnt[0].n).toBe(1);
  });

  it("routes a procurement decision to its typed ERP event plus the generic fact (Req 22.1)", async () => {
    const decisionId = randomUUID();
    const genericBefore = await outboxCount(EVENTS.decisionRecorded);
    const procBefore = await outboxCount(EVENTS.decisionProcurement);
    await run(
      msg(COMMANDS.decisionRecord, {
        decisionId,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Procure 50 laptops",
        type: "procurement",
        authority: "Finance Committee",
      }),
    );
    expect(await outboxCount(EVENTS.decisionRecorded)).toBe(genericBefore + 1);
    expect(await outboxCount(EVENTS.decisionProcurement)).toBe(procBefore + 1);
  });

  it("flags a high-value financial decision for GFR counter-signature and routes to workflow (Req 11.7, 20.8)", async () => {
    const decisionId = randomUUID();
    const finBefore = await outboxCount(EVENTS.decisionFinancial);
    const wfBefore = await outboxCount("workflow.instance.create");
    await run(
      msg(COMMANDS.decisionRecord, {
        decisionId,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Sanction ₹25 lakh capital expenditure",
        type: "financial",
        // 25 lakh in paise = 250,000,000 ≥ 10-lakh threshold (100,000,000).
        financialImplication: "250000000",
        currency: "INR",
      }),
    );
    const row = await readDecision(decisionId);
    expect(row?.workflow_triggered).toBe(true);
    expect(String(row?.financial_implication)).toBe("250000000");
    expect(await outboxCount(EVENTS.decisionFinancial)).toBe(finBefore + 1);
    expect(await outboxCount("workflow.instance.create")).toBe(wfBefore + 1);
  });

  it("does NOT route a below-threshold financial decision to workflow", async () => {
    const decisionId = randomUUID();
    await run(
      msg(COMMANDS.decisionRecord, {
        decisionId,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Minor spend",
        type: "financial",
        financialImplication: "5000000", // ₹50k < ₹10 lakh threshold
      }),
    );
    expect((await readDecision(decisionId))?.workflow_triggered).toBe(false);
  });
});

describe("decision.update", () => {
  it("applies a version-guarded patch and records a supersede back-pointer (Req 11.8)", async () => {
    const oldId = randomUUID();
    const newId = randomUUID();
    await run(
      msg(COMMANDS.decisionRecord, { decisionId: oldId, meetingId: MEETING, tenantId: TENANT, text: "Old policy", type: "policy" }),
    );
    await run(
      msg(COMMANDS.decisionRecord, { decisionId: newId, meetingId: MEETING, tenantId: TENANT, text: "New policy", type: "policy" }),
    );
    await run(
      msg(COMMANDS.decisionUpdate, {
        meetingId: MEETING,
        tenantId: TENANT,
        decisionId: oldId,
        version: 1,
        patch: { status: "superseded", supersededById: newId },
      }),
    );
    const row = await readDecision(oldId);
    expect(row?.status).toBe("superseded");
    expect(row?.superseded_by_id).toBe(newId);
    expect(row?.version).toBe(2);
  });

  it("rejects a self-supersession (permanent → DLQ)", async () => {
    const id = randomUUID();
    await run(msg(COMMANDS.decisionRecord, { decisionId: id, meetingId: MEETING, tenantId: TENANT, text: "x", type: "general" }));
    await expect(
      run(
        msg(COMMANDS.decisionUpdate, {
          meetingId: MEETING,
          tenantId: TENANT,
          decisionId: id,
          version: 1,
          patch: { supersededById: id },
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("is a no-op for an unknown decision (nothing to patch)", async () => {
    await expect(
      run(
        msg(COMMANDS.decisionUpdate, {
          meetingId: MEETING,
          tenantId: TENANT,
          decisionId: randomUUID(),
          version: 1,
          patch: { text: "ghost" },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("resolution.record", () => {
  it("assigns sequential per-committee-per-FY numbers (P25) and computes the passing result", async () => {
    const r1 = randomUUID();
    const r2 = randomUUID();
    await run(
      msg(COMMANDS.resolutionRecord, {
        resolutionId: r1,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Adopt annual budget",
        voteType: "electronic_poll",
        majorityRule: "simple_majority",
        votesFor: 3,
        votesAgainst: 1,
        votesAbstain: 0,
      }),
    );
    await run(
      msg(COMMANDS.resolutionRecord, {
        resolutionId: r2,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Approve audit plan",
        voteType: "electronic_poll",
        majorityRule: "two_thirds",
        votesFor: 1,
        votesAgainst: 3,
        votesAbstain: 0,
      }),
    );
    const row1 = await readResolution(r1);
    const row2 = await readResolution(r2);
    expect(row1?.result).toBe("passed");
    expect(row2?.result).toBe("rejected");
    // Sequential within FC / 2025-26 — numbers differ and increment.
    const seq = (n: string) => Number.parseInt(n.split("/").pop()!, 10);
    expect(row1?.resolution_number).toMatch(/^FC\/RES\/2025-26\/\d{3}$/);
    expect(row2?.resolution_number).toMatch(/^FC\/RES\/2025-26\/\d{3}$/);
    expect(seq(row2!.resolution_number)).toBe(seq(row1!.resolution_number) + 1);
    // A passing resolution emits resolution.passed; a failing one emits resolution.rejected.
    expect(await outboxCount(EVENTS.resolutionPassed)).toBeGreaterThan(0);
    expect(await outboxCount(EVENTS.resolutionRejected)).toBeGreaterThan(0);
  });

  it("rejects a resolution whose meeting is missing (permanent → DLQ)", async () => {
    await expect(
      run(
        msg(COMMANDS.resolutionRecord, {
          resolutionId: randomUUID(),
          meetingId: randomUUID(),
          tenantId: TENANT,
          text: "orphan",
          voteType: "roll_call",
          majorityRule: "simple_majority",
          votesFor: 1,
          votesAgainst: 0,
          votesAbstain: 0,
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("resolution.sign", () => {
  it("anchors the content hash and emits resolution.signed for a passed resolution (Req 11.5)", async () => {
    const rid = randomUUID();
    await run(
      msg(COMMANDS.resolutionRecord, {
        resolutionId: rid,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Resolved to sign",
        voteType: "electronic_poll",
        majorityRule: "simple_majority",
        votesFor: 3,
        votesAgainst: 0,
        votesAbstain: 0,
      }),
    );
    const signedBefore = await outboxCount(EVENTS.resolutionSigned);
    await run(msg(COMMANDS.resolutionSign, { resolutionId: rid, meetingId: MEETING, tenantId: TENANT, signerId: ACTOR }));
    const row = await readResolution(rid);
    // No DSC keystore configured in test → signature stays null but the integrity hash is set.
    expect(row?.hash_current).toMatch(/^[0-9a-f]{64}$/);
    expect(await outboxCount(EVENTS.resolutionSigned)).toBe(signedBefore + 1);
  });

  it("refuses to sign a rejected resolution (permanent → DLQ)", async () => {
    const rid = randomUUID();
    await run(
      msg(COMMANDS.resolutionRecord, {
        resolutionId: rid,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Rejected motion",
        voteType: "electronic_poll",
        majorityRule: "unanimous",
        votesFor: 1,
        votesAgainst: 2,
        votesAbstain: 0,
      }),
    );
    await expect(
      run(msg(COMMANDS.resolutionSign, { resolutionId: rid, meetingId: MEETING, tenantId: TENANT, signerId: ACTOR })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("rejects signing an unknown resolution (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.resolutionSign, { resolutionId: randomUUID(), meetingId: MEETING, tenantId: TENANT, signerId: ACTOR })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("resolution.circulation_init", () => {
  it("creates a circulation resolution anchored to the committee meeting and notifies members (Req 12.1)", async () => {
    const rid = randomUUID();
    await run(
      msg(COMMANDS.resolutionCirculationInit, {
        resolutionId: rid,
        tenantId: TENANT,
        committeeId: COMMITTEE,
        text: "Emergency procurement approval",
        deadline: new Date(Date.now() + 172800000).toISOString(),
        majorityRule: "simple_majority",
      }),
    );
    const row = await readResolution(rid);
    expect(row?.is_circulation).toBe(true);
    expect(row?.meeting_id).toBe(MEETING);
    expect(row?.result).toBe("invalid"); // provisional until the deadline/close computes it
    expect(row?.resolution_number).toMatch(/^FC\/RES\/2025-26\/\d{3}$/);
    // Each active member receives a distribution notification.
    expect(await outboxCount("notification.send")).toBeGreaterThanOrEqual(3);
  });

  it("rejects a circulation for a committee with no meeting to anchor to (permanent → DLQ)", async () => {
    await expect(
      run(
        msg(COMMANDS.resolutionCirculationInit, {
          resolutionId: randomUUID(),
          tenantId: TENANT,
          committeeId: randomUUID(),
          text: "orphan circulation",
          deadline: new Date(Date.now() + 86400000).toISOString(),
          majorityRule: "simple_majority",
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("dissent.record", () => {
  it("attaches a dissent note to the member's existing vote row (Req 11.6)", async () => {
    const rid = randomUUID();
    await run(
      msg(COMMANDS.resolutionRecord, {
        resolutionId: rid,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Contested motion",
        voteType: "roll_call",
        majorityRule: "simple_majority",
        votesFor: 2,
        votesAgainst: 1,
        votesAbstain: 0,
      }),
    );
    // Seed a vote row for MEMBER_B so the dissent note attaches to it.
    await tenantQuery(
      (sql) => sql`
        insert into meeting.votes (id, tenant_id, resolution_id, member_id, position, is_circulation)
        values (${randomUUID()}, ${TENANT}, ${rid}, ${MEMBER_B}, 'against', false)`,
    );
    await run(
      msg(COMMANDS.dissentRecord, { resolutionId: rid, meetingId: MEETING, tenantId: TENANT, memberId: MEMBER_B, note: "Procedural objection" }),
    );
    const voteRows = await tenantQuery(
      (sql) => sql`select reason from meeting.votes where resolution_id = ${rid} and member_id = ${MEMBER_B}`,
    );
    expect(voteRows[0]?.reason).toBe("Procedural objection");
  });

  it("records a dissent as an audit annexure even when the member has no vote row", async () => {
    const rid = randomUUID();
    await run(
      msg(COMMANDS.resolutionRecord, {
        resolutionId: rid,
        meetingId: MEETING,
        tenantId: TENANT,
        text: "Another motion",
        voteType: "roll_call",
        majorityRule: "simple_majority",
        votesFor: 2,
        votesAgainst: 0,
        votesAbstain: 0,
      }),
    );
    await expect(
      run(msg(COMMANDS.dissentRecord, { resolutionId: rid, meetingId: MEETING, tenantId: TENANT, memberId: MEMBER_C, note: "Late dissent" })),
    ).resolves.toBeUndefined();
  });

  it("rejects a dissent for an unknown resolution (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.dissentRecord, { resolutionId: randomUUID(), meetingId: MEETING, tenantId: TENANT, memberId: MEMBER_A, note: "x" })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
