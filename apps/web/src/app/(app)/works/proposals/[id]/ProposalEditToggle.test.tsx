import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ProposalEditToggle } from "./ProposalEditToggle";

const BASE_PROPOSAL = {
  id: "p1",
  status: "draft",
  description: "Village road repair",
  district: "Pune",
  taluka: "Haveli",
  village: "Wagholi",
  remarks: null,
};

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
}

describe("ProposalEditToggle — UX-006 (missing cost must not pre-fill as a fabricated 0)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("pre-fills the cost field from a real estimatedCostMinor", () => {
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: "1500000" }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    const input = screen.getByLabelText(/Estimated Cost/i) as HTMLInputElement;
    expect(input.value).toBe("15000");
  });

  it("leaves the cost field BLANK (not '0') when estimatedCostMinor is null", () => {
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: null }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    const input = screen.getByLabelText(/Estimated Cost/i) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.value).not.toBe("0");
  });

  it("leaves the cost field BLANK (not '0') when estimatedCostMinor is undefined", () => {
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: undefined }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    const input = screen.getByLabelText(/Estimated Cost/i) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.value).not.toBe("0");
  });

  it("distinguishes a genuine zero estimated cost from missing data", () => {
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: 0 }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    const input = screen.getByLabelText(/Estimated Cost/i) as HTMLInputElement;
    expect(input.value).toBe("0");
  });
});
