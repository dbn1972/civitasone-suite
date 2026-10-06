import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

/**
 * GAP-PROJECTS-DETAIL-05: a slipped project/milestone status "delayed" (and the
 * underscore/space variants of the states project-service emits) must not fall
 * through to the neutral "info" pill. in_progress / on_hold are asserted here
 * too to pin the audit's refuted claim: they already resolved via
 * normalizeStatusKey before this change, so they must stay non-"info".
 */
describe("StatusPill project statuses", () => {
  function toneClass(status: string): string {
    const { container } = render(<StatusPill status={status} />);
    return container.querySelector("span.pill")?.className ?? "";
  }

  it("maps 'delayed' to the bad tone (was neutral info before the fix)", () => {
    expect(toneClass("delayed")).toContain("bad");
    expect(toneClass("delayed")).not.toContain("info");
  });

  it("maps 'in_progress' (snake_case) to warn via normalization — refutes the 'unmapped' claim", () => {
    expect(toneClass("in_progress")).toContain("warn");
    expect(toneClass("in_progress")).not.toContain("info");
  });

  it("maps 'on_hold' (snake_case) to warn via normalization — refutes the 'unmapped' claim", () => {
    expect(toneClass("on_hold")).toContain("warn");
    expect(toneClass("on_hold")).not.toContain("info");
  });
});
