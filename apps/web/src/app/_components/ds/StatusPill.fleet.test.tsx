import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

/**
 * GAP-FLEET-VEHICLES-02: a fleet vehicle's "in_maintenance" / "decommissioned"
 * status must not fall through to the neutral "info" pill (visually identical
 * to an unknown value and to a serviceable "active" vehicle). "in_maintenance"
 * is a temporary attention state (warn); "decommissioned" is a quiet terminal
 * state (mut). The on-wire snake_case form must resolve via normalizeStatusKey.
 */
describe("StatusPill fleet vehicle statuses", () => {
  function toneClass(status: string): string {
    const { container } = render(<StatusPill status={status} />);
    return container.querySelector("span.pill")?.className ?? "";
  }

  it("maps 'in_maintenance' (snake_case) to warn, not info", () => {
    expect(toneClass("in_maintenance")).toContain("warn");
    expect(toneClass("in_maintenance")).not.toContain("info");
  });

  it("maps 'in maintenance' (spaced) to warn, not info", () => {
    expect(toneClass("in maintenance")).toContain("warn");
  });

  it("maps 'decommissioned' to mut, not info", () => {
    expect(toneClass("decommissioned")).toContain("mut");
    expect(toneClass("decommissioned")).not.toContain("info");
  });

  it("keeps 'active' as good (regression)", () => {
    expect(toneClass("active")).toContain("good");
  });
});
