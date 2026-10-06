import { describe, it, expect } from "vitest";
import { deriveWorkflow, stepClass } from "./observationWorkflow";

function states(status: string, hasReply: boolean) {
  return Object.fromEntries(deriveWorkflow(status, hasReply).map((s) => [s.key, s.state]));
}

describe("deriveWorkflow (GAP-AUDIT-OBSERVATIONS-DETAIL-01)", () => {
  it("closed → every step done (Closure no longer stuck on todo)", () => {
    expect(states("closed", true)).toEqual({ raised: "done", reply: "done", committee: "done", closure: "done" });
  });

  it("open with no reply → Reply is current", () => {
    const s = states("open", false);
    expect(s.raised).toBe("done");
    expect(s.reply).toBe("current");
    expect(s.committee).toBe("todo");
    expect(s.closure).toBe("todo");
  });

  it("open with a reply already → Reply done", () => {
    expect(states("open", true).reply).toBe("done");
  });

  it("replied → Committee review current", () => {
    expect(states("replied", true)).toEqual({ raised: "done", reply: "done", committee: "current", closure: "todo" });
  });

  it("compliance_pending / partially_closed → Closure current", () => {
    expect(states("compliance_pending", true).closure).toBe("current");
    expect(states("partially_closed", true).closure).toBe("current");
  });

  it("unknown status → only Raised done", () => {
    expect(states("on_hold", false)).toEqual({ raised: "done", reply: "todo", committee: "todo", closure: "todo" });
  });

  it("stepClass maps to ds timeline classes", () => {
    expect(stepClass("done")).toBe("done");
    expect(stepClass("current")).toBe("cur");
    expect(stepClass("todo")).toBe("todo");
  });
});
