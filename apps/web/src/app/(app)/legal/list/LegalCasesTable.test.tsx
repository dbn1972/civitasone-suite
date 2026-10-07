import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const resourceMock = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => resourceMock(...a) }));

import { LegalCasesTable, isWritOrCriminal, ACTIVE_CASE_STATUSES } from "./LegalCasesTable";

type Row = Record<string, unknown>;
const row = (over: Row = {}): Row => ({
  id: "c-1",
  caseNo: "WP-2026-1",
  title: "State v. X",
  court: "High Court of Delhi",
  type: "writ",
  advocateName: "Adv. Rao",
  status: "pending",
  ...over,
});
function mockRows(rows: Row[]) {
  resourceMock.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null, fromCache: false });
}

describe("LegalCasesTable predicate/constants (shared with page)", () => {
  // GAP-LEGAL-LIST-01: one predicate backs both the card and the filter.
  it("isWritOrCriminal matches writ and criminal only", () => {
    expect(isWritOrCriminal({ type: "writ" })).toBe(true);
    expect(isWritOrCriminal({ type: "criminal" })).toBe(true);
    expect(isWritOrCriminal({ type: "civil" })).toBe(false);
    expect(isWritOrCriminal({ type: "arbitration" })).toBe(false);
  });

  // GAP-LEGAL-LIST-02: active statuses include appealed and stayed.
  it("ACTIVE_CASE_STATUSES covers pending, appealed and stayed", () => {
    expect([...ACTIVE_CASE_STATUSES].sort()).toEqual(["appealed", "pending", "stayed"]);
  });
});

describe("LegalCasesTable rendering", () => {
  beforeEach(() => resourceMock.mockReset());

  // GAP-LEGAL-LIST-03: the type column shows a human label, not the raw code.
  it("renders a human case-type label (Writ Petition) not the raw 'writ' code", () => {
    mockRows([row({ type: "writ" })]);
    render(<LegalCasesTable items={[]} source="api" />);
    expect(screen.getByText("Writ Petition")).toBeInTheDocument();
    expect(screen.getByText("Case type")).toBeInTheDocument(); // column relabelled from "Subject"
    expect(screen.queryByText("Subject")).not.toBeInTheDocument();
  });

  // GAP-LEGAL-LIST-01: the honest "Writ & criminal" filter uses the shared predicate.
  it("filters to writ & criminal rows under the renamed filter", () => {
    mockRows([
      row({ id: "a", caseNo: "WP-1", type: "writ" }),
      row({ id: "b", caseNo: "CR-1", type: "criminal" }),
      row({ id: "c", caseNo: "CS-1", type: "civil" }),
    ]);
    render(<LegalCasesTable items={[]} source="api" />);
    fireEvent.click(screen.getByRole("tab", { name: "Writ & criminal" }));
    expect(screen.getByText("WP-1")).toBeInTheDocument();
    expect(screen.getByText("CR-1")).toBeInTheDocument();
    expect(screen.queryByText("CS-1")).not.toBeInTheDocument();
    // the misleading "Adverse risk" label is gone.
    expect(screen.queryByRole("tab", { name: "Adverse risk" })).not.toBeInTheDocument();
  });
});
