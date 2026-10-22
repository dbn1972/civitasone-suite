import { describe, it, expect } from "vitest";
import { mapAuditRows } from "./loaders";

const RAW = {
  id: "5f1c0a52-8c6e-4a46-9e3a-0c3b6f4f1a11",
  type: "audit.event.record",
  target: "case-1",
  occurredAt: "2026-10-01T10:00:00.000Z",
  severity: "info",
};

// GAP-HR-AUDIT-LOG-06/08: what audit-service's GET /audit/events really returns
// for an outbox-written event -- a generic type, an actor with only the
// actorId, and the producer's verb/outcome/resource inside `payload`.
describe("mapAuditRows -- raw audit-service rows (GAP-HR-AUDIT-LOG-06/08)", () => {
  it("shows the producer's action (payload.action), not the generic 'audit.event.record' type", () => {
    const [row] = mapAuditRows([
      { ...RAW, actor: { actorId: "u-1", email: "a@gov.in" }, payload: { service: "hrms", action: "create", resourceType: "apar", resourceId: "apar-9", outcome: "success" } },
    ])!;
    expect(row).toMatchObject({ action: "create", resourceType: "apar", resourceId: "apar-9", actor: "a@gov.in" });
  });

  it("keeps an event whose actor carries only an actorId (APAR / disciplinary events) instead of dropping it", () => {
    const rows = mapAuditRows([{ ...RAW, actor: { actorId: "11111111-2222-3333-4444-555555555555" }, payload: { action: "open", outcome: "success" } }])!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("prefers email, then name, then actorId", () => {
    const actors = mapAuditRows([
      { ...RAW, actor: { actorId: "u", email: "e@gov.in", name: "N" }, payload: { action: "x", outcome: "success" } },
      { ...RAW, actor: { actorId: "u", name: "Name Only" }, payload: { action: "x", outcome: "success" } },
    ])!.map((r) => r.actor);
    expect(actors).toEqual(["e@gov.in", "Name Only"]);
  });

  it("skips an event that has no identifiable actor at all", () => {
    expect(mapAuditRows([{ ...RAW, actor: {}, payload: { action: "x", outcome: "success" } }, { ...RAW, actor: { actorId: "u" }, payload: { action: "x" } }])).toHaveLength(1);
  });

  it("falls back to the event type only when there is no action at all", () => {
    const [row] = mapAuditRows([{ ...RAW, type: "hrms.employee.update", actor: { actorId: "u" }, payload: {} }])!;
    expect(row!.action).toBe("hrms.employee.update");
  });

  it("reads the outcome from payload.outcome -- a real failure is not turned into 'success' by the default info severity", () => {
    const rows = mapAuditRows([
      { ...RAW, severity: "info", actor: { actorId: "u" }, payload: { action: "x", outcome: "failure" } },
      { ...RAW, severity: "info", actor: { actorId: "u" }, payload: { action: "x", outcome: "success" } },
      { ...RAW, severity: "info", actor: { actorId: "u" }, payload: { action: "x", outcome: "skipped" } },
    ])!;
    expect(rows.map((r) => r.outcome)).toEqual(["failure", "success", "skipped"]);
  });

  it("falls back to a known severity only when no outcome was stated: error/critical -> failure, info/warning -> success", () => {
    const outcomes = (sev: string) => mapAuditRows([{ ...RAW, severity: sev, actor: { actorId: "u" }, payload: { action: "x" } }])![0]!.outcome;
    expect(outcomes("error")).toBe("failure");
    expect(outcomes("critical")).toBe("failure");
    expect(outcomes("info")).toBe("success");
    expect(outcomes("warning")).toBe("success");
  });

  it("an event with neither an outcome nor a recognisable severity is 'unknown' -- never success, and not a guessed failure", () => {
    const { severity: _drop, ...noSeverity } = RAW;
    void _drop;
    const [row] = mapAuditRows([{ ...noSeverity, actor: { actorId: "u" }, payload: { action: "x" } }])!;
    expect(row!.outcome).toBe("unknown");
    const [odd] = mapAuditRows([{ ...RAW, severity: "debug", actor: { actorId: "u" }, payload: { action: "x" } }])!;
    expect(odd!.outcome).toBe("unknown");
  });
});

describe("mapAuditRows -- already-flattened rows still map as before", () => {
  it("top-level outcome wins and the action/actor strings pass through", () => {
    const [row] = mapAuditRows([{ id: "e", actor: "a@gov.in", action: "hrms.employee.update", resource: "emp-1", outcome: "failure", timestamp: "2026-10-01T10:00:00.000Z" }])!;
    expect(row).toMatchObject({ actor: "a@gov.in", action: "hrms.employee.update", resource: "emp-1", outcome: "failure", at: "2026-10-01T10:00:00.000Z" });
  });

  it("an empty list stays a clean empty list, a non-list payload is a parse failure", () => {
    expect(mapAuditRows([])).toEqual([]);
    expect(mapAuditRows({})).toBeNull();
  });
});
