/**
 * UAT F81 / F82: meeting and resolution numbers must be unique per tenant (real DB).
 *
 * Before the fix the number was MAX(existing)+1 read per committee, formatted with the committee
 * code or a shared `MTG` / `RES/RES` fallback:
 *   - parallel creates under ONE committee read the same MAX and got the same number;
 *   - every committee WITHOUT a code formatted `MTG/<FY>/001`, so code-less committees collided;
 *   - code-less resolutions were `RES/RES/<FY>/001` on every committee.
 * Migration 0014 archives the pre-existing duplicates and adds partial UNIQUE indexes.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const CODE = `F81${randomUUID().slice(0, 4).toUpperCase()}`;
const CODED = randomUUID();
const CODELESS_A = randomUUID();
const CODELESS_B = randomUUID();
const SCHEDULED_AT = "2026-11-20T10:00:00.000Z"; // FY 2026-27
const FY = "2026-27";
const PARALLEL = 8;

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));
registerDecisionConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T): CommandEnvelope<T> {
  return {
    messageId: randomUUID(),
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

function tenantQuery<T>(tenant: string, fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(tenant, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${tenant}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

/** Fire `n` meeting.create commands at once; every one must commit. */
async function createInParallel(committeeIds: string[]): Promise<string[]> {
  const ids = committeeIds.map(() => randomUUID());
  const results = await Promise.allSettled(
    committeeIds.map((committeeId, i) =>
      run(
        msg(COMMANDS.meetingCreate, {
          id: ids[i],
          tenantId: TENANT,
          title: `F81 parallel ${i}`,
          type: "committee",
          scheduledAt: SCHEDULED_AT,
          durationMinutes: 60,
          committeeId,
          chairpersonId: ACTOR,
          secretaryId: ACTOR,
        }),
      ),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  expect(failed.map((f) => String(f.reason))).toEqual([]);
  return ids;
}

async function meetingNumbers(ids: string[]): Promise<string[]> {
  const rows = await tenantQuery(TENANT, (sql) =>
    sql`select meeting_number from meeting.meetings where id in ${sql(ids)}`);
  return rows.map((r) => r.meeting_number as string);
}

beforeAll(async () => {
  await tenantQuery(TENANT, async (sql) => {
    for (const [id, code] of [[CODED, CODE], [CODELESS_A, null], [CODELESS_B, null]] as const) {
      await sql`
        insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
        values (${id}, ${TENANT}, ${`F81 committee ${id.slice(0, 8)}`}, ${code}, 'finance', '2025-01-01',
                ${sql.json({ minMembers: 1 })}, ${ACTOR}, ${ACTOR})`;
    }
  });
});

describe("F81: meeting numbers are unique per tenant under concurrency", () => {
  it("parallel creates under one coded committee get distinct sequential numbers", async () => {
    const ids = await createInParallel(Array.from({ length: PARALLEL }, () => CODED));
    const numbers = await meetingNumbers(ids);
    expect(new Set(numbers).size).toBe(PARALLEL);
    expect(numbers.sort()).toEqual(
      Array.from({ length: PARALLEL }, (_, i) => `${CODE}/${FY}/${String(i + 1).padStart(3, "0")}`),
    );
  });

  it("parallel creates across committees WITHOUT a code share one MTG series and never collide", async () => {
    const committees = Array.from({ length: PARALLEL }, (_, i) => (i % 2 === 0 ? CODELESS_A : CODELESS_B));
    const ids = await createInParallel(committees);
    const numbers = await meetingNumbers(ids);
    expect(new Set(numbers).size).toBe(PARALLEL);
    expect(numbers.sort()).toEqual(
      Array.from({ length: PARALLEL }, (_, i) => `MTG/${FY}/${String(i + 1).padStart(3, "0")}`),
    );
  });
});

describe("F82: resolution numbers are unique per tenant and the RES prefix is not doubled", () => {
  it("parallel circulation resolutions on two code-less committees get distinct RES/<FY>/<n> numbers", async () => {
    const committees = [CODELESS_A, CODELESS_B, CODELESS_A, CODELESS_B];
    const ids = committees.map(() => randomUUID());
    const results = await Promise.allSettled(
      committees.map((committeeId, i) =>
        run(
          msg(COMMANDS.resolutionCirculationInit, {
            resolutionId: ids[i],
            tenantId: TENANT,
            committeeId,
            text: `F82 circulation ${i}`,
            deadline: new Date(Date.now() + 172_800_000).toISOString(),
            majorityRule: "simple_majority",
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const rows = await tenantQuery(TENANT, (sql) =>
      sql`select resolution_number from meeting.resolutions where id in ${sql(ids)}`);
    const numbers = rows.map((r) => r.resolution_number as string).sort();
    expect(new Set(numbers).size).toBe(ids.length);
    expect(numbers).toEqual(["001", "002", "003", "004"].map((n) => `RES/${FY}/${n}`));
  });
});

describe("migration 0014: archives existing duplicates, then enforces uniqueness", () => {
  it("flags all but the earliest duplicate in every tenant, leaves empty numbers alone, and rejects a new duplicate", async () => {
    // The migration runs against a scratch copy of the two tables (pre-0014 shape, FORCE RLS on,
    // like the live schema) inside a transaction that is rolled back, so it never takes DDL locks
    // on the shared meeting.* tables other test files are using.
    const scratch = `f81_mig_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const migration = (await readFile(new URL("../migrations/0014_meeting_number_uniqueness.sql", import.meta.url), "utf8"))
      .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "")
      .replace(/\bmeeting\.(meetings|resolutions|number_sequences)\b/g, `${scratch}.$1`);
    const tenants = [randomUUID(), randomUUID()];
    const DUP = `F81M/${FY}/001`;
    const ROLLBACK = new Error("rollback");
    type Seeded = { meetings: string[]; blanks: string[]; resolutions: string[] };
    const seeded = new Map<string, Seeded>();

    const outcome = await sqlClient
      .begin(async (sql) => {
        await sql.unsafe(`
          CREATE SCHEMA ${scratch};
          CREATE TABLE ${scratch}.meetings (LIKE meeting.meetings INCLUDING DEFAULTS);
          CREATE TABLE ${scratch}.resolutions (LIKE meeting.resolutions INCLUDING DEFAULTS);
          ALTER TABLE ${scratch}.meetings DROP COLUMN IF EXISTS test_data_archived_at;
          ALTER TABLE ${scratch}.resolutions DROP COLUMN IF EXISTS test_data_archived_at;
          ALTER TABLE ${scratch}.meetings ENABLE ROW LEVEL SECURITY;
          ALTER TABLE ${scratch}.meetings FORCE ROW LEVEL SECURITY;
          ALTER TABLE ${scratch}.resolutions ENABLE ROW LEVEL SECURITY;
          ALTER TABLE ${scratch}.resolutions FORCE ROW LEVEL SECURITY;
          CREATE POLICY t ON ${scratch}.meetings USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
          CREATE POLICY t ON ${scratch}.resolutions USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`);

        for (const t of tenants) {
          await sql`select set_config('app.tenant_id', ${t}, true)`;
          const s: Seeded = { meetings: [randomUUID(), randomUUID(), randomUUID()], blanks: [randomUUID(), randomUUID()], resolutions: [randomUUID(), randomUUID()] };
          seeded.set(t, s);
          for (const [i, id] of s.meetings.entries()) {
            await sql`
              insert into ${sql(scratch)}.meetings (id, tenant_id, type, title, status, meeting_number, created_at, created_by, updated_by)
              values (${id}, ${t}, 'committee', 'dup', 'draft', ${DUP}, ${new Date(Date.UTC(2026, 9, 3 - i)).toISOString()}, ${ACTOR}, ${ACTOR})`;
          }
          for (const id of s.blanks) {
            await sql`
              insert into ${sql(scratch)}.meetings (id, tenant_id, type, title, status, meeting_number, created_by, updated_by)
              values (${id}, ${t}, 'committee', 'blank', 'draft', '', ${ACTOR}, ${ACTOR})`;
          }
          for (const [i, id] of s.resolutions.entries()) {
            await sql`
              insert into ${sql(scratch)}.resolutions
                (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, is_circulation, created_at, created_by, updated_by)
              values (${id}, ${t}, ${s.meetings[i]}, ${`RES/RES/${FY}/001`}, 'dup', 'roll_call', 'simple_majority', 'passed', 'effective', false,
                      ${new Date(Date.UTC(2026, 9, 1 + i)).toISOString()}, ${ACTOR}, ${ACTOR})`;
          }
        }

        // Run as the migration runner would: no tenant GUC set.
        await sql`select set_config('app.tenant_id', '', true)`;
        await sql.unsafe(migration);
        await sql.unsafe(migration); // idempotent re-run

        const perTenant: Record<string, unknown> = {};
        for (const t of tenants) {
          await sql`select set_config('app.tenant_id', ${t}, true)`;
          const ms = await sql`select id from ${sql(scratch)}.meetings where test_data_archived_at is not null`;
          const rs = await sql`select id from ${sql(scratch)}.resolutions where test_data_archived_at is not null`;
          const errorCode = async (q: () => Promise<unknown>) => {
            try {
              await sql.savepoint(() => q());
              return null;
            } catch (err) {
              return (err as { code?: string }).code ?? String(err);
            }
          };
          perTenant[t] = {
            archivedMeetings: ms.map((x) => x.id as string).sort(),
            archivedResolutions: rs.map((x) => x.id as string),
            newDuplicateMeeting: await errorCode(() => sql`
              insert into ${sql(scratch)}.meetings (id, tenant_id, type, title, status, meeting_number, created_by, updated_by)
              values (${randomUUID()}, ${t}, 'committee', 'new dup', 'draft', ${DUP}, ${ACTOR}, ${ACTOR})`),
            newDuplicateResolution: await errorCode(() => sql`
              insert into ${sql(scratch)}.resolutions
                (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, is_circulation, created_by, updated_by)
              values (${randomUUID()}, ${t}, ${randomUUID()}, ${`RES/RES/${FY}/001`}, 'new dup', 'roll_call', 'simple_majority', 'passed', 'effective', false, ${ACTOR}, ${ACTOR})`),
            // Unnumbered drafts stay legitimate.
            anotherBlankDraft: await errorCode(() => sql`
              insert into ${sql(scratch)}.meetings (id, tenant_id, type, title, status, meeting_number, created_by, updated_by)
              values (${randomUUID()}, ${t}, 'committee', 'blank 3', 'draft', null, ${ACTOR}, ${ACTOR})`),
          };
        }
        throw Object.assign(ROLLBACK, { result: perTenant });
      })
      .catch((err: unknown) => {
        if (err === ROLLBACK) return (err as Error & { result: unknown }).result;
        throw err;
      });

    const expected: Record<string, unknown> = {};
    for (const t of tenants) {
      const s = seeded.get(t)!;
      expected[t] = {
        // meetings[2] has the earliest created_at and keeps the number.
        archivedMeetings: [s.meetings[0], s.meetings[1]].sort(),
        archivedResolutions: [s.resolutions[1]],
        newDuplicateMeeting: "23505",
        newDuplicateResolution: "23505",
        anotherBlankDraft: null,
      };
    }
    expect(outcome).toEqual(expected);
  });
});
