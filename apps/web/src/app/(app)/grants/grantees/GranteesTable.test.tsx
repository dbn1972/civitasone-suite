import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: <T,>(_key: string, initialData: T) => ({
    data: initialData,
    provenance: "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { GranteesTable } from "./GranteesTable";
import type { GranteeSummary } from "@civitasone/types";

const ROW: GranteeSummary = {
  id: "ben-1",
  granteeCode: "BEN1",
  name: "Asha Devi",
  type: "society",
  registrationNo: "AAATR1234F",
  activeGrants: 1,
  totalGrantsReceived: 500000,
  ucCompliancePct: 80,
} as unknown as GranteeSummary;

describe("GranteesTable", () => {
  // GAP-GRANTS-GRANTEES-05: the Type cell shows a proper label, not the raw enum uppercased.
  it("renders the grantee type as a readable label, not SOCIETY", () => {
    render(<GranteesTable grantees={[ROW]} source="api" />);
    expect(screen.getByText("Society")).toBeInTheDocument();
    expect(screen.queryByText("SOCIETY")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-GRANTEES-04: a non-privileged viewer sees the registration number masked.
  it("masks the registration number for a non-privileged viewer", () => {
    render(<GranteesTable grantees={[ROW]} source="api" canViewRegistration={false} />);
    expect(screen.getByText("•••• 234F")).toBeInTheDocument();
    expect(screen.queryByText("AAATR1234F")).not.toBeInTheDocument();
  });

  it("shows the registration number in the clear for a privileged viewer", () => {
    render(<GranteesTable grantees={[ROW]} source="api" canViewRegistration={true} />);
    expect(screen.getByText("AAATR1234F")).toBeInTheDocument();
  });

  // GAP-GRANTS-GRANTEES-04: rows link to the grantee detail route.
  it("links rows to the grantee detail route", () => {
    render(<GranteesTable grantees={[ROW]} source="api" />);
    const link = screen.getByRole("link", { name: /Open BEN1/ });
    expect(link).toHaveAttribute("href", "/grants/grantees/ben-1");
  });
});
