import { describe, expect, it } from "vitest";
import {
  formatPaise,
  mapSandboxSteps,
  parseDemandLines,
  parseJournalPreview,
  resolveThreePartError,
} from "./sandboxTestModel";

describe("resolveThreePartError", () => {
  it("uses structured why/next from the sandbox API", () => {
    const three = resolveThreePartError({
      error: "The intake form is not configured. Citizens cannot apply without at least one form section. Open the Form block and add fields.",
      why: "Citizens cannot apply without at least one form section.",
      next: "Open the Form block and add fields.",
    });
    expect(three?.what).toMatch(/intake form is not configured/i);
    expect(three?.why).toMatch(/cannot apply/i);
    expect(three?.next).toMatch(/Form block/i);
  });

  it("falls back when only a flat error string is present", () => {
    const three = resolveThreePartError({ error: "Broken fee formula." });
    expect(three?.what).toBe("Broken fee formula.");
    expect(three?.why).toBeTruthy();
    expect(three?.next).toBeTruthy();
  });
});

describe("mapSandboxSteps", () => {
  it("maps block links and peels three-part errors", () => {
    const steps = mapSandboxSteps(
      [
        {
          id: "form",
          label: "Intake form validates",
          status: "fail",
          error: "The intake form is not configured. Citizens cannot apply without at least one form section. Open the Form block and add fields.",
          why: "Citizens cannot apply without at least one form section.",
          next: "Open the Form block and add fields.",
          blockLink: "/designer/__ID__/b2#form",
        },
        {
          id: "demand",
          label: "Fee demand lines",
          status: "pass",
          artifacts: { sampleLines: [{ label: "Base fee", amountMinor: 50000, taxHeadCode: "BASE" }] },
        },
      ],
      "def-9",
    );

    const form = steps.find((s) => s.id === "form")!;
    expect(form.status).toBe("fail");
    expect(form.blockLink).toBe("/designer/def-9/b2#form");
    expect(form.why).toMatch(/cannot apply/i);
    expect(form.next).toMatch(/Form block/i);

    const demand = steps.find((s) => s.id === "demand")!;
    expect(parseDemandLines(demand.artifacts)[0]?.amountMinor).toBe(50000);
  });

  it("marks skipped steps without failing the gate", () => {
    const steps = mapSandboxSteps(
      [{ id: "payment", label: "Sandbox payment", status: "skip" }],
      "def-1",
    );
    const payment = steps.find((s) => s.id === "payment")!;
    expect(payment.status).toBe("pass");
    expect(payment.skipped).toBe(true);
  });
});

describe("artifact formatters", () => {
  it("formats paise and journal preview", () => {
    expect(formatPaise(50000)).toContain("500");
    expect(parseJournalPreview({
      journalPreview: { debit: "4201", credit: "CASH", amountMinor: 50000 },
    })).toEqual({ debit: "4201", credit: "CASH", amountMinor: 50000 });
  });
});
