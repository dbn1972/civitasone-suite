import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getBeneficiariesMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getProjectBeneficiaries: (...a: unknown[]) => getBeneficiariesMock(...a),
}));
vi.mock("./BeneficiariesTable", () => ({
  BeneficiariesTable: () => <div>table</div>,
}));

import BeneficiariesPage from "./page";

function row(verified: string, id: string) {
  return { id, name: id, project: "P", district: "D", category: "C", verified, disbursement: "0" };
}

describe("GAP-PROJECTS-BENEFICIARIES-02 verification tiles", () => {
  beforeEach(() => getBeneficiariesMock.mockReset());

  it("shows Verified=active, Pending=pending only, Rejected=rejected (rejected NOT counted as pending)", async () => {
    getBeneficiariesMock.mockResolvedValue({
      data: [
        row("active", "a1"), row("active", "a2"), row("active", "a3"),
        row("pending", "p1"), row("pending", "p2"),
        row("rejected", "r1"),
      ],
      source: "api",
    });
    render(await BeneficiariesPage());
    expect(screen.getByText("Verified").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Pending Verification").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Rejected").parentElement).toHaveTextContent("1");
    // The old duplicate "Active" tile must be gone.
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });
});
