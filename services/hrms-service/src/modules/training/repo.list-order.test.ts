/**
 * listTrainingsByTenant: real Postgres. Upcoming/ongoing programmes are listed before
 * ended or cancelled ones (soonest first, then the most recently started ended ones),
 * and a [from, to] window is applied in SQL BEFORE the LIMIT, so a programme inside the
 * window is never cut off by the row cap.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import { hrmsTrainings } from "./schema.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

/** "YYYY-MM-DD" `days` from today, on the IST calendar the service uses. */
function istDay(days: number): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  ist.setUTCDate(ist.getUTCDate() + days);
  return ist.toISOString().slice(0, 10);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function seed(tx: Tx, key: string, from: number, to: number, status = "planned") {
  await tx.insert(hrmsTrainings).values({
    id: randomUUID(), tenantId: TENANT, title: key, fromDate: istDay(from), toDate: istDay(to),
    maxParticipants: 10, status, createdBy: ACTOR, updatedBy: ACTOR,
  });
}

beforeAll(async () => {
  await runWithTenant(TENANT, async () => {
    await db.transaction(async (tx) => {
      // Inserted in a deliberately unhelpful order (oldest first).
      await seed(tx, "ended-old", -60, -58);
      await seed(tx, "ended-recent", -10, -8);
      await seed(tx, "cancelled", 5, 6, "cancelled");
      await seed(tx, "upcoming-late", 40, 42);
      await seed(tx, "upcoming-soon", 3, 4);
      await seed(tx, "ongoing", -1, 2);
    });
  });
});

const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title);

describe("listTrainingsByTenant", () => {
  it("lists ongoing/upcoming (soonest first) before ended and cancelled programmes", async () => {
    const rows = await runWithTenant(TENANT, () => repo.listTrainingsByTenant(TENANT, 100));
    const order = titles(rows);
    expect(order.slice(0, 3)).toEqual(["ongoing", "upcoming-soon", "upcoming-late"]);
    // ended / cancelled follow, most recently started first
    expect(order.slice(3)).toEqual(["cancelled", "ended-recent", "ended-old"]);
  });

  it("applies the LIMIT after the ordering, so the cap keeps the upcoming programmes", async () => {
    const rows = await runWithTenant(TENANT, () => repo.listTrainingsByTenant(TENANT, 2));
    expect(titles(rows)).toEqual(["ongoing", "upcoming-soon"]);
  });

  it("filters the date window in SQL before the LIMIT (an in-window programme is not cut off)", async () => {
    // Window around the old ended programme only; with LIMIT 1 an in-memory filter over the
    // first row (an upcoming one) would return nothing.
    const rows = await runWithTenant(TENANT, () =>
      repo.listTrainingsByTenant(TENANT, 1, { from: istDay(-61), to: istDay(-57) }));
    expect(titles(rows)).toEqual(["ended-old"]);
  });

  it("overlap rule: a programme touching a window edge is in, one wholly outside is out", async () => {
    const rows = await runWithTenant(TENANT, () =>
      repo.listTrainingsByTenant(TENANT, 100, { from: istDay(2), to: istDay(3) }));
    // ongoing ends on day 2, upcoming-soon starts on day 3; the cancelled one (5..6) is outside
    expect(titles(rows).sort()).toEqual(["ongoing", "upcoming-soon"]);
  });
});
