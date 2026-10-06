import { describe, it, expect } from "vitest";
import { slaLabel, SLA_LABELS } from "./slaLabels";

describe("slaLabel (GAP-HELPDESK-CATALOGUE-MY-REQUESTS-03 / BREACHES-05)", () => {
  it("maps known statuses to correctly-cased labels", () => {
    expect(slaLabel("within_sla")).toBe("Within SLA");
    expect(slaLabel("due_soon")).toBe("Due soon");
    expect(slaLabel("at_risk")).toBe("At risk");
    expect(slaLabel("breached")).toBe("Breached");
  });

  it("handles different separator styles", () => {
    expect(slaLabel("within-sla")).toBe("Within SLA");
    expect(slaLabel("WITHIN_SLA")).toBe("Within SLA");
    expect(slaLabel("within sla")).toBe("Within SLA");
  });

  it("falls back gracefully for unknown values", () => {
    expect(slaLabel("unknown_status")).toBe("Unknown Status");
    expect(slaLabel(null)).toBe("Unknown");
    expect(slaLabel(undefined)).toBe("Unknown");
    expect(slaLabel("")).toBe("Unknown");
  });

  it("keeps SLA uppercase in the fallback", () => {
    expect(slaLabel("sla_pending")).toBe("SLA Pending");
  });

  it("exports SLA_LABELS for direct lookup", () => {
    expect(SLA_LABELS.within_sla).toBe("Within SLA");
    expect(SLA_LABELS.breached).toBe("Breached");
  });
});
