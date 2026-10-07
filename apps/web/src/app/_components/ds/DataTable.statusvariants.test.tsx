import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DataTable } from "./DataTable";

/**
 * GAP-CHANGE-HOME-04: a cellType:"status" column can override the global
 * STATUS_MAP tone per value via statusVariants, so change-request risk
 * (low/medium/high) and type (emergency) get meaningful colours WITHOUT adding
 * those words to the shared STATUS_MAP (where they would recolour
 * priority/severity pills in crm/finance/helpdesk/projects).
 */
type Row = { id: string; risk: string };

function pillClass(risk: string, variants?: Record<string, "good" | "warn" | "bad">): string {
  const { container } = render(
    <DataTable<Row>
      columns={[{ key: "risk", label: "Risk", cellType: "status", statusVariants: variants }]}
      rows={[{ id: "1", risk }]}
    />,
  );
  return container.querySelector("span.pill")?.className ?? "";
}

describe("DataTable statusVariants override", () => {
  it("colours 'high' as bad when a statusVariants map is provided", () => {
    expect(pillClass("high", { low: "good", medium: "warn", high: "bad" })).toContain("bad");
  });

  it("colours 'emergency' as bad via the override", () => {
    expect(pillClass("emergency", { emergency: "bad" })).toContain("bad");
  });

  it("without the override 'high' falls through to the neutral info pill (proves no global recolour)", () => {
    // 'high' is NOT in the shared STATUS_MAP, so unqualified it stays neutral.
    expect(pillClass("high")).toContain("info");
  });
});
