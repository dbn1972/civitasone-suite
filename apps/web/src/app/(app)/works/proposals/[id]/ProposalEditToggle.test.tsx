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
    expect(input.value).toBe("15000.00");
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
    expect(input.value).toBe("0.00");
  });
});

/**
 * GAP-WORKS-PROPOSALS-DETAIL-03 (MONEY): the edit form must prefill the exact
 * paise value as a rupee string and must NOT re-PATCH estimatedCostMinor when
 * the clerk hasn't touched the field — the old Math.round(minor/100) prefill
 * silently rewrote ₹86,50,000.50 to ₹86,50,001 on an unrelated save.
 */
describe("ProposalEditToggle — DETAIL-03 exact money (bigint paise)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("prefills a fractional paise cost exactly, with two decimals", () => {
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: "865000050" }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    const input = screen.getByLabelText(/Estimated Cost/i) as HTMLInputElement;
    expect(input.value).toBe("8650000.50");
  });

  it("does NOT PATCH the cost when it is opened and saved unchanged", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: "865000050" }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    // Save with no field edits at all.
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/No changes detected\./i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends an exact paise value when the clerk edits the cost", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: "865000050" }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    fireEvent.change(screen.getByLabelText(/Estimated Cost/i), { target: { value: "8650000.75" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await screen.findByText(/Proposal updated\./i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.estimatedCostMinor).toBe("865000075");
  });

  it("rejects an over-precise amount with an inline message, no PATCH", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    render(
      <ProposalEditToggle
        proposal={{ ...BASE_PROPOSAL, estimatedCostMinor: "865000050" }}
        roles={["works_admin"]}
      />,
    );
    openForm();
    fireEvent.change(screen.getByLabelText(/Estimated Cost/i), { target: { value: "8650000.505" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText(/valid amount in rupees/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

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
    expect(alert.textContent).toMatch(/This proposal was changed by someone else\. Refresh to see the latest version, then try again\./);
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
