/**
 * Integration test: attendance check-in/check-out timestamps have no sanity bound, at any layer.
 *
 * CORRECTNESS AUDIT FINDING (MEDIUM/HIGH — no temporal validation), core-lifecycle cluster.
 *
 * `attendance/validators.ts#attendanceCheckInSchema.checkInAt` is `z.coerce.date().optional()`
 * — any parseable date, no `.min()`/`.max()`, no comparison to the meeting's `scheduledAt`.
 * `attendance/domain.ts#isJoinedLate` / `resolveCheckInStatus` only use `checkInAt` to classify
 * present-vs-joined_late; neither they nor `attendance/consumer.ts#handleCheckIn` (~333-417)
 * reject a `checkInAt` that is absurdly early or late relative to the meeting.
 *
 * `attendance/consumer.ts#handleCheckOut` (~420+) does a plain
 * `UPDATE ... SET check_out_at = ${checkOutAt}` with no read of the existing `check_in_at` and
 * no comparison — a check-out strictly BEFORE its own check-in (a negative attendance duration)
 * is accepted.
 *
 * There is no defense-in-depth at the database either: `migrations/0001_meeting_core.sql`'s
 * `meeting.attendance_records` table has no `CHECK (check_out_at IS NULL OR check_out_at >
 * check_in_at)` constraint (contrast `meeting.room_bookings`, which DOES get a real
 * `EXCLUDE USING gist` guard for its own overlap invariant — attendance got no equivalent).
 *
 * Reproduced live below via the real consumer + Postgres, and by inserting directly against the
 * schema to confirm the database itself imposes no bound either.
 *
 * _Cluster: attendance (core-lifecycle audit)._
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerParticipantConsumers } from "../src/modules/participant/consumer.js";
import { registerAttendanceConsumers } from "../src/modules/attendance/consumer.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const CHAIR = randomUUID();
const SECRETARY = randomUUID();
const EMPLOYEE = randomUUID();

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));
registerParticipantConsumers((topic, h) => handlers.set(topic, h as any));
registerAttendanceConsumers((topic, h) => handlers.set(topic, h as any));

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

async function seedMeetingWithParticipant(scheduledAt: Date): Promise<{ meetingId: string; participantId: string }> {
  const meetingId = randomUUID();
  await run(
    msg(COMMANDS.meetingCreate, {
      id: meetingId,
      tenantId: TENANT,
      title: "Attendance-bounds fixture meeting",
      type: "committee",
      scheduledAt: scheduledAt.toISOString(),
      durationMinutes: 60,
      chairpersonId: CHAIR,
      secretaryId: SECRETARY,
    }),
  );
  const participantId = randomUUID();
  await run(
    msg(COMMANDS.participantAdd, {
      meetingId,
      tenantId: TENANT,
      participants: [{ id: participantId, employeeId: EMPLOYEE, role: "member", isMandatory: true }],
    }),
  );
  return { meetingId, participantId };
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.attendance_records WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.participants WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
});

afterAll(async () => {
  await sqlClient.end();
});

describe("attendance: checkInAt/checkOutAt are bounded against the meeting and each other", () => {
  it("a check-in for a meeting scheduled far in the future is rejected", async () => {
    const farFuture = new Date(Date.now() + 365 * 86_400_000); // one year from now
    const { meetingId, participantId } = await seedMeetingWithParticipant(farFuture);

    const bogusCheckInAt = new Date().toISOString(); // "now" -- a year before the meeting happens
    const attendanceId = randomUUID();
    await expect(
      run(
        msg(COMMANDS.attendanceCheckIn, {
          attendanceId,
          meetingId,
          tenantId: TENANT,
          participantId,
          method: "manual",
          mode: "in_person",
          checkInAt: bogusCheckInAt,
        }),
      ),
    ).rejects.toThrow();

    const rows = await tenantQuery(
      (sql) => sql`SELECT check_in_at FROM meeting.attendance_records WHERE id = ${attendanceId} AND tenant_id = ${TENANT}`,
    );
    // Fixed: rejected before any row was persisted -- check_in_at ~1 year before the meeting's
    // own scheduled_at is now outside the sane bound (attendance/validators.ts, Req 6.1).
    expect((rows as any[]).length).toBe(0);
  });

  it("checkInAt backdated years into the past, for a meeting scheduled today, is rejected", async () => {
    const { meetingId, participantId } = await seedMeetingWithParticipant(new Date(Date.now() + 3_600_000));

    const yearsAgo = new Date("2015-01-01T09:00:00.000Z").toISOString();
    const attendanceId = randomUUID();
    await expect(
      run(
        msg(COMMANDS.attendanceCheckIn, {
          attendanceId,
          meetingId,
          tenantId: TENANT,
          participantId,
          method: "manual",
          mode: "in_person",
          checkInAt: yearsAgo,
        }),
      ),
    ).rejects.toThrow();

    const rows = await tenantQuery(
      (sql) => sql`SELECT check_in_at FROM meeting.attendance_records WHERE id = ${attendanceId} AND tenant_id = ${TENANT}`,
    );
    expect((rows as any[]).length).toBe(0);
  });

  it("checkOutAt strictly BEFORE checkInAt is rejected -- no negative attendance duration persists", async () => {
    const { meetingId, participantId } = await seedMeetingWithParticipant(new Date(Date.now() + 3_600_000));

    const checkInAt = new Date();
    const checkOutAt = new Date(checkInAt.getTime() - 60 * 60_000); // one hour BEFORE check-in

    const attendanceId = randomUUID();
    // The check-in ITSELF is legitimate (well within the meeting's window) and must succeed.
    await run(
      msg(COMMANDS.attendanceCheckIn, {
        attendanceId,
        meetingId,
        tenantId: TENANT,
        participantId,
        method: "manual",
        mode: "in_person",
        checkInAt: checkInAt.toISOString(),
      }),
    );
    await expect(
      run(
        msg(COMMANDS.attendanceCheckOut, {
          meetingId,
          tenantId: TENANT,
          participantId,
          checkOutAt: checkOutAt.toISOString(),
        }),
      ),
    ).rejects.toThrow();

    const rows = await tenantQuery(
      (sql) => sql`SELECT check_in_at, check_out_at FROM meeting.attendance_records WHERE id = ${attendanceId} AND tenant_id = ${TENANT}`,
    );
    const row = (rows as any[])[0];
    // Fixed: the check-in persisted (it was valid), but check_out_at was never written -- the
    // rejected checkout leaves it NULL rather than a negative duration.
    expect(row.check_in_at).not.toBeNull();
    expect(row.check_out_at).toBeNull();
  });

  it("the database itself now rejects check_out_at < check_in_at (fix 8 CHECK constraint, defense-in-depth)", async () => {
    const { meetingId, participantId } = await seedMeetingWithParticipant(new Date(Date.now() + 3_600_000));
    const id = randomUUID();
    const checkIn = new Date();
    const checkOut = new Date(checkIn.getTime() - 5 * 3_600_000); // 5 hours before check-in

    // Direct INSERT against the schema, bypassing the application layer entirely -- proves the
    // invariant is now enforced at the data layer too (chk_attendance_checkout_after_checkin,
    // migrations/0010_core_lifecycle_constraints.sql).
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.attendance_records
          (id, tenant_id, meeting_id, participant_id, method, check_in_at, check_out_at, mode, status, created_by, updated_by)
        VALUES
          (${id}, ${TENANT}, ${meetingId}, ${participantId}, 'manual', ${checkIn.toISOString()}, ${checkOut.toISOString()}, 'in_person', 'present', ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();

    const rows = await tenantQuery((sql) => sql`SELECT check_in_at, check_out_at FROM meeting.attendance_records WHERE id = ${id}`);
    expect((rows as any[]).length).toBe(0); // the INSERT never committed
  });
});
