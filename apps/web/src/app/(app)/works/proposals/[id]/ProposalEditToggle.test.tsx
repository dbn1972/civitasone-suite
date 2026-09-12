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

/**
 * UX-016: on failure this form used to `throw new Error((d as
 * {message?:string}).message ?? \`Update failed (${res.status})\`)` and
 * show that raw text/status verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("ProposalEditToggle — UX-016 clerk-safe errors", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows a clerk-safe message, never the raw HTTP status, when saving fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 409, headers: { "content-type": "application/json" } }),
    );
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: "1500000" }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "Updated description" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't save/i);
    expect(alert.textContent).not.toMatch(/409/);
  });

  it("renders an inline field-level message from a fieldErrors response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "district", message: "District must be a recognised district name." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: "1500000" }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    fireEvent.change(screen.getByLabelText(/District/i), { target: { value: "Nowhereland" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("District must be a recognised district name.")).toBeInTheDocument();
  });
});
