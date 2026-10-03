import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProvisionStepsTable } from "./ProvisionStepsTable";

const steps = [
  { step: 1, name: "Org", description: "d1", required: "Yes" },
  { step: 2, name: "Domain", description: "d2", required: "Optional" },
];

describe("ProvisionStepsTable (GAP-ADMIN-TENANT-PROVISION-04/-05)", () => {
  it("shows Required as a filled pill and Optional as a muted pill", () => {
    render(<ProvisionStepsTable steps={steps} />);
    expect(screen.getByText("Required", { selector: ".pill" })).toHaveClass("good");
    expect(screen.getByText("Optional", { selector: ".pill" })).toHaveClass("mut");
    expect(document.querySelector(".pill.info")).toBeNull();
  });
  it("is not sortable: headers are not sort buttons and rows stay in step order", () => {
    render(<ProvisionStepsTable steps={steps} />);
    expect(screen.queryAllByRole("button", { name: /sort/i })).toHaveLength(0);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Org");
    expect(rows[1]).toHaveTextContent("Domain");
  });
});
