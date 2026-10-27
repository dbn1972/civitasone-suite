import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ConfigProposalsPanel, type ConfigProposal } from "./ConfigProposalsPanel";

const PENDING: ConfigProposal = {
  id: "p1", kind: "rate_slab", action: "revise", status: "pending", makerUserId: "maker-1",
  effectiveFrom: "2026-11-01", targetId: "s1", rateHeadId: "h1", payload: { rateValue: "150000" }, decisionReason: null,
};
const DECIDED: ConfigProposal = { ...PENDING, id: "p2", status: "approved", makerUserId: "maker-1", decisionReason: "tariff order" };

describe("ConfigProposalsPanel (owner decision #2: maker-checker rate config)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists pending proposals under 'Awaiting approval' with Approve/Reject for a different officer", () => {
    render(<ConfigProposalsPanel proposals={[PENDING, DECIDED]} currentUserId="checker-1" />);
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getAllByText(/New version of a rate slab/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Approve rate-config proposal" })).toBeEnabled();
  });

  it("disables the decision for the officer who proposed it (separation of duties)", () => {
    render(<ConfigProposalsPanel proposals={[PENDING]} currentUserId="maker-1" />);
    expect(screen.getByRole("button", { name: "Approve rate-config proposal" })).toBeDisabled();
    expect(screen.getByText(/different officer must decide/i)).toBeInTheDocument();
  });

  it("shows recent decisions read-only with their status", () => {
    render(<ConfigProposalsPanel proposals={[DECIDED]} currentUserId="checker-1" />);
    expect(screen.getByText("Recent decisions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve rate-config proposal/ })).not.toBeInTheDocument();
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });

  it("shows nothing at all when there are no proposals", () => {
    const { container } = render(<ConfigProposalsPanel proposals={[]} currentUserId="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("previews the effect on a computed demand before approval", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        data: {
          blocked: null,
          changes: [{ op: "update", table: "rate_slabs", id: "s1", values: { effectiveTo: "2026-11-01" } }, { op: "insert", table: "rate_slabs", values: { rateValue: "150000" } }],
          sample: {
            asOfDate: "2026-11-01", dueDate: "2026-08-03", baseValue: "10000000",
            before: { principal: "100000", rebate: "0", penalty: "0", interest: "0", net: "100000" },
            after: { principal: "150000", rebate: "0", penalty: "0", interest: "0", net: "150000" },
          },
        },
      }), { status: 200 }),
    );
    render(<ConfigProposalsPanel proposals={[PENDING]} currentUserId="checker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview proposal" }));
    const table = await screen.findByLabelText("Before and after on a sample demand");
    expect(table).toHaveTextContent("₹1,000.00");
    expect(table).toHaveTextContent("₹1,500.00");
    expect(screen.getByText(/old row ends 1 Nov 2026|ends .*2026/i)).toBeInTheDocument();
  });

  it("explains why a proposal cannot be previewed or applied instead of showing a broken preview", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { blocked: "A rate slab for this rate head already covers an overlapping band/effective period", changes: [], sample: null } }), { status: 200 }),
    );
    render(<ConfigProposalsPanel proposals={[PENDING]} currentUserId="checker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview proposal" }));
    expect(await screen.findByText(/already covers an overlapping/)).toBeInTheDocument();
  });

  it("surfaces a clerk-safe error when the preview cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<ConfigProposalsPanel proposals={[PENDING]} currentUserId="checker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview proposal" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
