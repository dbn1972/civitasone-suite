/**
 * One SLA / pendency definition across the dashboard, My Desk and the file register
 * (GAP-ESTAB-DASHBOARD-01).
 *
 * services/estab-service/tests/dashboard-sla-pendency-real-db.test.ts seeds six files and asserts the
 * dashboard reads: slaBreached 2, avgPendencyDays 15, filesPending/filesActive 3. These tests push the
 * SAME six files, in the shape GET /v1/estab/files returns them, through mapEstabFileSummaries and the
 * shared helpers (lib/estab/sla.ts) that My Desk and the register use, and expect the same numbers.
 * Closed and draft files used to be folded into "active" by the mapper, which made these differ.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mapEstabFileSummaries } from "./apiMappers";
import { isClosedStatus, isOverdue, pendencyDays } from "@/lib/estab/sla";

// 10:00 IST on 21 Oct 2026.
const NOW = new Date("2026-10-21T10:00:00+05:30");
const H = 3_600_000;
const D = 24 * H;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

type Seed = { no: string; status: string; dueAgoMs: number | null; createdAgoMs: number };

/** The files the service's real-DB dashboard test seeds, as GET /v1/estab/files returns them. */
const SEEDS: Seed[] = [
  { no: "SLA/1", status: "active",   dueAgoMs: 25 * H, createdAgoMs: 10 * D },  // overdue
  { no: "SLA/2", status: "draft",    dueAgoMs: 3 * D,  createdAgoMs: 20 * D },  // overdue: a draft is open
  { no: "SLA/3", status: "active",   dueAgoMs: 0,      createdAgoMs: 0 },       // due today: not overdue
  { no: "SLA/4", status: "closed",   dueAgoMs: 30 * D, createdAgoMs: 100 * D }, // closed: excluded
  { no: "SLA/5", status: "archived", dueAgoMs: 30 * D, createdAgoMs: 200 * D }, // archived: excluded
  { no: "SLA/6", status: "active",   dueAgoMs: null,   createdAgoMs: 30 * D },  // no due date: never overdue
];

const payloadOf = (seeds: Seed[]) => ({
  data: seeds.map((s, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    fileNo: s.no,
    subject: `Subject ${s.no}`,
    classification: "unclassified",
    dept: "ADMIN",
    createdByName: "Asha Rao",
    currentWith: "officer-1",
    status: s.status,
    dueBy: s.dueAgoMs === null ? null : ago(s.dueAgoMs),
    createdAt: ago(s.createdAgoMs),
  })),
});

describe("web counts agree with the dashboard definition on the same files (GAP-ESTAB-DASHBOARD-01)", () => {
  const files = mapEstabFileSummaries(payloadOf(SEEDS)) ?? [];

  it("keeps closed distinct and presents a draft as active (a file in work), so neither closed nor archived is folded into active", () => {
    expect(files.map((f) => f.status)).toEqual(["active", "active", "active", "closed", "archived", "active"]);
  });

  it("My Desk: overdue = open files past due = 2 (closed and archived never, due-today not, a draft yes)", () => {
    expect(files.filter((f) => isOverdue(f)).length).toBe(2);
  });

  it("register: Active Files = status active = 4 (3 service-active + 1 draft shown as active), and finished files = closed + archived = 2", () => {
    expect(files.filter((f) => f.status === "active").length).toBe(4);
    expect(files.filter((f) => isClosedStatus(f.status)).length).toBe(2);
  });

  it("average pendency over open files = 15 days (10, 20, 0, 30); closed and archived are ignored", () => {
    const days = files.map((f) => pendencyDays(f)).filter((d): d is number => d !== null);
    expect(days.sort((a, b) => a - b)).toEqual([0, 10, 20, 30]);
    expect(days.reduce((a, b) => a + b, 0) / days.length).toBe(15);
  });
});

describe("IST calendar days, not UTC dates, near IST midnight (GAP-ESTAB-DASHBOARD-01)", () => {
  // 00:30 IST on 21 Oct is 19:00 UTC on 20 Oct: the UTC date is a day behind the IST day.
  const justAfterISTMidnight = "2026-10-20T19:00:00.000Z";
  // 23:30 IST on 20 Oct is 18:00 UTC on 20 Oct.
  const justBeforeISTMidnight = "2026-10-20T18:00:00.000Z";

  const row = (id: string, due: string, created: string) => ({
    id, fileNo: id, subject: id, classification: "unclassified", status: "active", dueBy: due, createdAt: created,
  });
  const [afterMidnight, beforeMidnight] = mapEstabFileSummaries({
    data: [
      row("00000000-0000-4000-8000-0000000000a1", justAfterISTMidnight, justAfterISTMidnight),
      row("00000000-0000-4000-8000-0000000000a2", justBeforeISTMidnight, justBeforeISTMidnight),
    ],
  }) ?? [];

  it("a file due at 00:30 IST today is due today, so it is not overdue (the UTC date would call it a day late)", () => {
    expect(afterMidnight?.dueDate).toBe("2026-10-21");
    expect(isOverdue(afterMidnight!)).toBe(false);
  });

  it("a file due at 23:30 IST yesterday is overdue", () => {
    expect(beforeMidnight?.dueDate).toBe("2026-10-20");
    expect(isOverdue(beforeMidnight!)).toBe(true);
  });

  it("pendency counts IST days since creation", () => {
    expect(pendencyDays(afterMidnight!)).toBe(0);
    expect(pendencyDays(beforeMidnight!)).toBe(1);
  });
});
