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

import { GrantsTable } from "./GrantsTable";
import type { GrantSummary } from "@civitasone/types";

const ROW: GrantSummary = {
  id: "grant-1",
  grantNo: "GR-2026-04",
  title: "Water supply",
  granteeName: "Asha Devi",
  totalAmount: 1000000,
  disbursedAmount: 400000,
  pendingAmount: 600000,
  sanctionDate: "2026-08-12",
  status: "active",
} as unknown as GrantSummary;

describe("GrantsTable", () => {
  // GAP-GRANTS-LIST-03: non-privileged viewer sees the grantee name masked.
  it("masks the grantee name for a non-privileged viewer", () => {
    render(<GrantsTable grants={[ROW]} source="api" canViewGranteeName={false} />);
    expect(screen.queryByText("Asha Devi")).not.toBeInTheDocument();
    expect(screen.getByText(/^A•+$/)).toBeInTheDocument();
  });

  it("shows the grantee name in the clear for a privileged viewer", () => {
    render(<GrantsTable grants={[ROW]} source="api" canViewGranteeName={true} />);
    expect(screen.getByText("Asha Devi")).toBeInTheDocument();
  });

  // GAP-GRANTS-LIST-04: no inconsistent "(₹)" unit on the Total heading.
  it("labels the Total column without a '(₹)' unit", () => {
    render(<GrantsTable grants={[ROW]} source="api" />);
    expect(screen.queryByText("Total (₹)")).not.toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });
});
