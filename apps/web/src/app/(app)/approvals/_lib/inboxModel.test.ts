import { describe, it, expect } from "vitest";
import {
  applyFilters, asGiven, buildRows, moduleOf, NO_FILTERS, personLabel, presentable, recordHref, referenceFromInstanceName, slaOf, sortRows, typeOf,
  type InboxTask, type RefSummary,
} from "./inboxModel";

const NOW = Date.parse("2026-11-05T06:30:00.000Z"); // 12:00 IST
const DAY = 86_400_000;

function task(id: string, over: Partial<InboxTask> = {}): InboxTask {
  return { id, instanceId: `i-${id}`, name: "Review", status: "pending", refType: "procurement_po", refId: `r-${id}`, dueAt: null, createdAt: new Date(NOW - 3 * DAY).toISOString(), ...over };
}
function summary(t: InboxTask, over: Partial<RefSummary> = {}): RefSummary {
  return { refType: t.refType!, refId: t.refId!, kind: "business", instanceId: t.instanceId, instanceName: "PO Approval", reference: "PO/2026/0033", amountMinor: "12345600", fields: [], maker: { name: "Anita Verma", designation: "Section Officer" }, stage: { level: 2, of: 3, step: "Deputy Secretary" }, ...over };
}

describe("presentable / personLabel: no ids, codes, placeholders or Unknown (system fields only)", () => {
  it.each([
    ["a51b49b9-8de6-4c1e-9d3f-2b8f0c1d2e3f", null],
    ["Approved by a51b49b9-8de6-4c1e-9d3f-2b8f0c1d2e3f", null],
    ["{{message}}", null],
    ["tenant_admin", null],
    // PR #2460 review, blocker 1: only genuine UUIDs and known role codes are ids; numbers are not.
    ["Sanction 12345678 attached", "Sanction 12345678 attached"],
    ["IND/20261104", "IND/20261104"],
    ["Deputy Secretary 04112026", "Deputy Secretary 04112026"],
    ["proc_head", null],
    ["Unknown officer", null],
    ["", null],
    ["PO/2026/0033", "PO/2026/0033"],
    ["Deputy Secretary Approval", "Deputy Secretary Approval"],
  ])("%s -> %s", (input, out) => {
    expect(presentable(input)).toBe(out);
  });

  it("joins name and designation, drops a code-like designation", () => {
    expect(personLabel({ name: "Anita Verma", designation: "Section Officer" })).toBe("Anita Verma, Section Officer");
    expect(personLabel({ name: "Anita Verma", designation: "tenant_admin" })).toBe("Anita Verma");
    expect(personLabel({ name: "82310d88-a7e7-440d-9f0b-1c2d3e4f5a6b", designation: null })).toBeNull();
    expect(personLabel(null)).toBeNull();
  });
});

describe("module and type of a refType", () => {
  it("maps known refTypes and degrades unknown ones to other", () => {
    expect(moduleOf("procurement_po_amendment")).toBe("procurement");
    expect(moduleOf("leave_app")).toBe("leave");
    expect(moduleOf("payroll_run")).toBe("payroll");
    expect(moduleOf("asset_disposal")).toBe("other");
    expect(typeOf("procurement_po")).toBe("purchaseOrder");
    expect(typeOf("asset_disposal")).toBe("other");
    expect(typeOf(null)).toBe("other");
  });

  it("links only to record routes that exist", () => {
    expect(recordHref("procurement_po", "x")).toBe("/procurement/orders/x");
    expect(recordHref("procurement_po_amendment", "a", "po1")).toBe("/procurement/orders/po1");
    expect(recordHref("procurement_po_amendment", "a")).toBeNull();
    expect(recordHref("leave_app", "x")).toBeNull();
    expect(recordHref("asset_disposal", "x")).toBeNull();
  });
});

describe("SLA in IST calendar days", () => {
  it("overdue, due today, due soon, on track, none", () => {
    expect(slaOf(new Date(NOW - 2 * DAY).toISOString(), NOW)).toEqual({ state: "overdue", days: 2 });
    expect(slaOf(new Date(NOW + 3 * 3_600_000).toISOString(), NOW)).toEqual({ state: "dueToday", days: 0 });
    expect(slaOf(new Date(NOW + 2 * DAY).toISOString(), NOW)).toEqual({ state: "dueSoon", days: 2 });
    expect(slaOf(new Date(NOW + 9 * DAY).toISOString(), NOW).state).toBe("onTrack");
    expect(slaOf(null, NOW)).toEqual({ state: "none", days: 0 });
  });
});

describe("filters and ordering", () => {
  const tasks = [
    task("a", { dueAt: new Date(NOW + 9 * DAY).toISOString() }),
    task("b", { dueAt: new Date(NOW - 1 * DAY).toISOString(), refType: "leave_app" }),
    task("c", { dueAt: new Date(NOW - 4 * DAY).toISOString() }),
    task("d", { refType: "asset_disposal" }),
  ];
  const sums = [summary(tasks[0]!, { amountMinor: "50000000", reference: "PO/2026/0001" }), summary(tasks[1]!, { amountMinor: null, reference: null }), summary(tasks[2]!, { amountMinor: "-1850000", reference: "PO/2026/0099" })];
  const rows = buildRows(tasks, sums, NOW);

  it("overdue first (most overdue first), then by age", () => {
    expect(sortRows(rows, "waiting").map((r) => r.task.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("module, type, SLA, amount range (rupees, a delta by its size) and reference search", () => {
    const ids = (f: Partial<typeof NO_FILTERS>) => applyFilters(rows, { ...NO_FILTERS, ...f }).map((r) => r.task.id).sort();
    expect(ids({ module: "leave" })).toEqual(["b"]);
    expect(ids({ type: "other" })).toEqual(["d"]);
    expect(ids({ sla: "overdue" })).toEqual(["b", "c"]);
    expect(ids({ minAmount: "1,00,000" })).toEqual(["a"]);
    expect(ids({ minAmount: "10000", maxAmount: "20000" })).toEqual(["c"]);
    expect(ids({ q: "0099" })).toEqual(["c"]);
    expect(ids({ q: "anita" })).toEqual(["a", "b", "c"]);
  });

  it("a missing summary leaves reference and amount null, never a fabricated value", () => {
    const d = rows.find((r) => r.task.id === "d")!;
    expect(d.reference).toBeNull();
    expect(d.amountMinor).toBeNull();
    expect(d.maker).toBeNull();
  });
});

describe("PR #2460 review", () => {
  it("references and module facts are shown as given, never filtered", () => {
    expect(asGiven(" IND/20261104 ")).toBe("IND/20261104");
    const t = task("r", { refType: "procurement_indent" });
    const [row] = buildRows([t], [summary(t, { reference: "IND/20261104" })], NOW);
    expect(row!.reference).toBe("IND/20261104");
  });

  it("a raw UUID in a name field is replaced (personLabel null), not shown", () => {
    expect(personLabel({ name: "3f2a9b1c-0d4e-4f5a-8b6c-7d8e9f0a1b2c", designation: "Section Officer" })).toBeNull();
  });

  it("a due date more than a year away either way is a plain date, not overdue", () => {
    expect(slaOf("2020-01-15T00:00:00.000Z", NOW).state).toBe("farDate");
    expect(slaOf(new Date(NOW + 400 * DAY).toISOString(), NOW).state).toBe("farDate");
    expect(slaOf(new Date(NOW - 300 * DAY).toISOString(), NOW).state).toBe("overdue");
    const rows = buildRows([task("old", { dueAt: "2020-01-15T00:00:00.000Z" }), task("new", { dueAt: new Date(NOW - DAY).toISOString() })], [], NOW);
    expect(sortRows(rows, "waiting").map((r) => r.task.id)).toEqual(["new", "old"]);
    expect(applyFilters(rows, { ...NO_FILTERS, sla: "overdue" }).map((r) => r.task.id)).toEqual(["new"]);
  });

  it("the age is when the item was raised, not when the current step opened", () => {
    const t = task("a", { createdAt: new Date(NOW).toISOString(), raisedAt: new Date(NOW - 6 * DAY).toISOString() });
    expect(buildRows([t], [], NOW)[0]!.age).toBe(6);
  });
});

describe("W9: rows for a viewer with no business summary still carry the item number", () => {
  it.each([
    ["indent", "Procurement Indent Approval \u2014 IND/2026/0081", "IND/2026/0081"],
    ["purchaseOrder", "Procurement PO Approval \u2014 PO/2026/0033", "PO/2026/0033"],
    ["poAmendment", "PO Amendment #2 Approval \u2014 PO/2026/0033", "PO/2026/0033"],
    ["procurementPlan", "Annual Procurement Plan Approval \u2014 APP/2026-27/004", "APP/2026-27/004"],
  ])("%s: number taken from the instance name", (type, name, want) => {
    expect(referenceFromInstanceName(type, name)).toBe(want);
  });

  it("does not invent a reference for leave (name carries only an id prefix), a bare name, or a UUID", () => {
    expect(referenceFromInstanceName("leave", "Leave Approval Workflow \u2014 4f2a9b1c")).toBeNull();
    expect(referenceFromInstanceName("indent", "Procurement Indent Approval")).toBeNull();
    expect(referenceFromInstanceName("indent", "Procurement Indent Approval \u2014 3f2a9b1c-0d4e-4f5a-8b6c-7d8e9f0a1b2c")).toBeNull();
    expect(referenceFromInstanceName("indent", null)).toBeNull();
  });

  it("buildRows: no summary -> reference from the task's instance name; a business summary still wins", () => {
    const t = task("w9", { refType: "procurement_indent", instanceName: "Procurement Indent Approval \u2014 IND/2026/0081" });
    expect(buildRows([t], [], NOW)[0]!.reference).toBe("IND/2026/0081");
    expect(buildRows([t], [summary(t, { reference: "IND/2026/9999" })], NOW)[0]!.reference).toBe("IND/2026/9999");
  });
});
