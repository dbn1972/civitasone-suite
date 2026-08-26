/**
 * Integration test: recurring meeting series generate at the wrong wall-clock time, and
 * `dayOfWeek`/`dayOfMonth` are captured but never consulted.
 *
 * CORRECTNESS AUDIT FINDING (HIGH — timezone bug + dead configuration), core-lifecycle cluster.
 *
 * 1. Timezone: `meeting-core/consumer.ts#toScheduledAt`:
 *      ```
 *      function toScheduledAt(dateIso: string, timeOfDay: string | null): Date {
 *        const time = timeOfDay && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay) ? timeOfDay : "00:00";
 *        return new Date(`${dateIso}T${time}:00Z`);
 *      }
 *      ```
 *    The literal `Z` suffix hardcodes UTC. `meeting_series.time_of_day` (validators.ts
 *    `timeOfDay`) is a bare `HH:MM` with NO offset/timezone field anywhere in the schema —
 *    there is no tenant/committee timezone concept ANYWHERE in this service (confirmed by
 *    grep: every date computation in calendar/domain.ts and meeting-core/domain.ts operates in
 *    UTC by design, see calendar/domain.ts's own header comment "All instants are treated as
 *    absolute (UTC)"). A secretary configuring a series for "10:00" — reasonably expecting
 *    10:00 AM in their own tenant's local time (this platform targets IST, UTC+5:30,
 *    municipal/government deployments) — actually gets every generated instance scheduled at
 *    10:00 UTC = 3:30 PM IST: a 5.5-hour discrepancy, silently, for every single occurrence.
 *    Contrast with plain (non-recurring) meeting creation, where `scheduledAt` is a full
 *    `z.string().datetime({ offset: true })` — the CLIENT is required to supply an explicit
 *    offset there. The series path has no equivalent field to supply one.
 *
 * 2. Dead config: `handleSeriesCreate` (consumer.ts ~669-688) stores `dayOfWeek`/`dayOfMonth` on
 *    the series row exactly as submitted. But `handleSeriesGenerate` (~737-834) computes
 *    instance dates via `generateInstanceDates()` (~314-332), which walks forward from
 *    `series.nextInstanceDate ?? series.startDate` in fixed weekly/fortnightly/monthly/... step
 *    increments (`advance()`, ~281-307) — `series.dayOfWeek` and `series.dayOfMonth` are never
 *    read anywhere in that path. A secretary who sets `startDate` on the 5th of the month but
 *    configures `dayOfMonth: 15` (intending "the 15th of every month") silently gets every
 *    instance on the 5th instead — the field they configured has zero effect.
 *
 * Both reproduced live below: generate a monthly series and inspect the actual persisted
 * `scheduled_at` of each materialised instance.
 *
 * _Cluster: meeting-core (core-lifecycle audit)._
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const COMMITTEE = randomUUID();
const CHAIR = randomUUID();
const SECRETARY = randomUUID();

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));

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

function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_series WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committee_members WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, voting_rule, created_by, updated_by)
    VALUES (${COMMITTEE}, ${TENANT}, 'Series Recurrence Test Committee', 'SRC', 'standing', '2025-01-01',
            ${JSON.stringify({ minMembers: 1 })}::jsonb, 'simple_majority', ${ACTOR}, ${ACTOR})`;
  });
  for (const m of [
    { memberId: CHAIR, role: "chairperson" },
    { memberId: SECRETARY, role: "secretary" },
  ]) {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`
      INSERT INTO meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, voting_right, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m.memberId}, ${m.role}, '2025-01-01', 'active', true, ${ACTOR}, ${ACTOR})`;
    });
  }

  // Fix 5 (timezone): config-registry's `meeting.tenant_timezone` defaults to "+00:00"
  // (behavior-preserving for a tenant that has configured nothing), so this tenant explicitly
  // configures IST — the platform's real deployment timezone — to prove the fix actually
  // converts `time_of_day` using it, rather than only exercising the (unchanged) UTC default.
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.config_entries (id, tenant_id, namespace, config_key, value, created_by, updated_by)
    VALUES (${randomUUID()}, ${TENANT}, 'meeting_policy', 'meeting.tenant_timezone', ${'"+05:30"'}::jsonb, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.end();
});

describe("meeting series: time_of_day is converted using the tenant's configured timezone", () => {
  it("a series configured for '10:00' with tenant timezone +05:30 (IST) materialises instances at 04:30 UTC (10:00 IST), not 10:00 UTC", async () => {
    const seriesId = randomUUID();
    await run(
      msg(COMMANDS.meetingSeriesCreate, {
        id: seriesId,
        tenantId: TENANT,
        committeeId: COMMITTEE,
        pattern: "monthly",
        startDate: "2027-01-05",
        dayOfMonth: 15, // configured, but (per finding 2 below) never consulted
        timeOfDay: "10:00", // no offset field exists anywhere to say "10:00 IST"
        durationMinutes: 60,
      }),
    );

    await run(msg(COMMANDS.meetingSeriesGenerate, { seriesId, upToDate: "2027-03-31" }));

    const rows = await tenantQuery(
      (sql) => sql`SELECT scheduled_at FROM meeting.meetings WHERE tenant_id = ${TENANT} AND series_id = ${seriesId} ORDER BY scheduled_at ASC`,
    );
    const instances = rows as any[];
    expect(instances.length).toBeGreaterThanOrEqual(3); // Jan, Feb, Mar

    for (const row of instances) {
      const d = new Date(row.scheduled_at);
      // 10:00 IST (+05:30) = 04:30 UTC. Fixed: the tenant's configured offset is now applied
      // instead of a hardcoded literal "Z" (UTC).
      expect(d.getUTCHours()).toBe(4);
      expect(d.getUTCMinutes()).toBe(30);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });
});

describe("meeting series: dayOfMonth/dayOfWeek are honoured when computing instance dates", () => {
  it("dayOfMonth=15 is honoured — every monthly instance lands on the 15th, not startDate's day (the 5th)", async () => {
    const seriesId = randomUUID();
    await run(
      msg(COMMANDS.meetingSeriesCreate, {
        id: seriesId,
        tenantId: TENANT,
        committeeId: COMMITTEE,
        pattern: "monthly",
        startDate: "2027-04-05", // the 5th
        dayOfMonth: 15, // secretary's intent: "the 15th of every month" -- silently ignored
        timeOfDay: "09:00",
        durationMinutes: 45,
      }),
    );
    // Confirm dayOfMonth really was persisted (it is captured, just not applied).
    const seriesRow = await tenantQuery(
      (sql) => sql`SELECT day_of_month FROM meeting.meeting_series WHERE id = ${seriesId} AND tenant_id = ${TENANT}`,
    );
    expect((seriesRow as any[])[0].day_of_month).toBe(15);

    await run(msg(COMMANDS.meetingSeriesGenerate, { seriesId, upToDate: "2027-06-30" }));

    const rows = await tenantQuery(
      (sql) => sql`SELECT scheduled_at FROM meeting.meetings WHERE tenant_id = ${TENANT} AND series_id = ${seriesId} ORDER BY scheduled_at ASC`,
    );
    const instances = rows as any[];
    expect(instances.length).toBeGreaterThanOrEqual(3); // Apr, May, Jun

    for (const row of instances) {
      const d = new Date(row.scheduled_at);
      // Fixed: every instance lands on day 15 (the configured dayOfMonth), not day 5
      // (startDate's own day).
      expect(d.getUTCDate()).toBe(15);
    }
  });

  it("dayOfWeek is honoured for weekly recurrence — instances land on the configured weekday, not startDate's", async () => {
    const seriesId = randomUUID();
    // startDate 2027-07-05 is a Monday (UTC). Configure dayOfWeek=5 (Friday) — intent:
    // "every Friday" — but nothing in generateInstanceDates ever reads it.
    const startDate = "2027-07-05";
    expect(new Date(`${startDate}T00:00:00Z`).getUTCDay()).toBe(1); // sanity: Monday

    await run(
      msg(COMMANDS.meetingSeriesCreate, {
        id: seriesId,
        tenantId: TENANT,
        committeeId: COMMITTEE,
        pattern: "weekly",
        startDate,
        dayOfWeek: 5, // Friday -- configured, silently ignored
        timeOfDay: "14:00",
        durationMinutes: 30,
      }),
    );

    await run(msg(COMMANDS.meetingSeriesGenerate, { seriesId, upToDate: "2027-07-26" }));

    const rows = await tenantQuery(
      (sql) => sql`SELECT scheduled_at FROM meeting.meetings WHERE tenant_id = ${TENANT} AND series_id = ${seriesId} ORDER BY scheduled_at ASC`,
    );
    const instances = rows as any[];
    expect(instances.length).toBeGreaterThanOrEqual(3);

    for (const row of instances) {
      const d = new Date(row.scheduled_at);
      // Fixed: every instance falls on Friday (5), as dayOfWeek requested — never Monday (1).
      expect(d.getUTCDay()).toBe(5);
    }
  });
});
