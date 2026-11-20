/**
 * GAP-CRM display: the assignment log / ageing view and the rule editor must show a
 * person's name, never a raw UUID. The service resolves ownerId / assignedBy /
 * fallbackOwnerId to names; these units cover the client-side shaping + fallback.
 */
import { describe, it, expect } from "vitest";
import { resolvedActorName, normaliseLog, normaliseRule } from "./assignment";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("resolvedActorName", () => {
  it("prefers the resolved display name", () => {
    expect(resolvedActorName("Asha Rao", UUID)).toBe("Asha Rao");
  });
  it("shows 'Unknown user' for an unresolved opaque UUID (never the raw id)", () => {
    expect(resolvedActorName(undefined, UUID)).toBe("Unknown user");
    expect(resolvedActorName("", UUID)).toBe("Unknown user");
  });
  it("keeps a non-UUID handle (e.g. 'system') when there is no name", () => {
    expect(resolvedActorName(undefined, "system")).toBe("system");
  });
  it("returns null when there is no actor at all (caller renders 'unassigned')", () => {
    expect(resolvedActorName(undefined, undefined)).toBeNull();
    expect(resolvedActorName(undefined, "")).toBeNull();
  });
});

describe("normaliseLog carries resolved actor names", () => {
  it("keeps ownerName / assignedByName when the service sends them", () => {
    const [e] = normaliseLog([
      { ownerId: UUID, ruleId: "r1", method: "auto", assignedAt: "2026-01-01T00:00:00Z", assignedBy: UUID, ownerName: "Asha Rao", assignedByName: "Ravi Das" },
    ]);
    expect(e.ownerName).toBe("Asha Rao");
    expect(e.assignedByName).toBe("Ravi Das");
  });
  it("omits the names when the service does not resolve them", () => {
    const [e] = normaliseLog([{ ownerId: UUID, ruleId: "r1", method: "auto", assignedAt: "x", assignedBy: UUID }]);
    expect(e.ownerName).toBeUndefined();
    expect(e.assignedByName).toBeUndefined();
  });
});

describe("normaliseRule carries the resolved fallback-owner name", () => {
  it("keeps fallbackOwnerName when present", () => {
    const r = normaliseRule({ name: "Territory North", ruleType: "territory", fallbackOwnerId: UUID, fallbackOwnerName: "Asha Rao" });
    expect(r?.fallbackOwnerName).toBe("Asha Rao");
  });
  it("omits it when unresolved", () => {
    const r = normaliseRule({ name: "Territory North", ruleType: "territory", fallbackOwnerId: UUID });
    expect(r?.fallbackOwnerName).toBeUndefined();
  });
});
