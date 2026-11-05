import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DetailList } from "./DetailList";
import { RecordHeader } from "./RecordHeader";
import { SummaryStrip } from "./SummaryStrip";
import { ApprovalTrail, trailActionLabel } from "./ApprovalTrail";

describe("DetailList (DS-6: labels never glued to values)", () => {
  it("renders a dl with separate dt/dd so label and value never run together", () => {
    const { container } = render(<DetailList ariaLabel="Sanction details" items={[{ label: "Sanction No", value: "W7-SAN-0012", mono: true }, { label: "Remarks", value: "", wide: true }, null]} />);
    expect(container.querySelector("dl")).toHaveAttribute("aria-label", "Sanction details");
    const dts = container.querySelectorAll("dt");
    const dds = container.querySelectorAll("dd");
    expect(dts).toHaveLength(2);
    expect(dts[0]!.textContent).toBe("Sanction No");
    expect(dds[0]!.textContent).toBe("W7-SAN-0012");
    expect(dds[1]!.textContent).toBe("—");
  });
});

describe("RecordHeader (R5)", () => {
  it("shows record no, a status badge with text, the amount in Indian format, parties and ONE primary action", () => {
    render(
      <RecordHeader
        kind="Sanction"
        recordNo="W7-SAN-0012"
        subtitle="Laptops for DDO office"
        status="approved"
        amountMinor="14445763"
        parties={[{ label: "Sanctioned by", value: "Asha Rao, Section Officer" }, null]}
        primaryAction={<button type="button" className="btn primary">Print sanction order</button>}
        outcome="Approved by N. Gupta, DDO on 30 Oct 2026."
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sanction W7-SAN-0012");
    const summary = screen.getByLabelText("Sanction summary");
    expect(within(summary).getByText("Approved")).toBeInTheDocument();
    expect(within(summary).getByText("₹1,44,457.63")).toBeInTheDocument();
    expect(within(summary).getByText("Asha Rao, Section Officer")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Approved by N. Gupta, DDO on 30 Oct 2026.");
  });

  it("says when no number is allocated yet, and omits empty amount and status", () => {
    render(<RecordHeader kind="Bill" recordNo="  " />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bill (number not yet allocated)");
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Amount")).toBeNull();
  });
});

describe("SummaryStrip (DS-7: slim strip instead of KPI cards)", () => {
  it("renders counts as one line of filter links", () => {
    render(<SummaryStrip ariaLabel="GRN summary" items={[{ label: "GRNs", value: 19 }, { label: "accepted", value: 11, href: "/procurement/grn?status=accepted", tone: "good" }, false]} />);
    const strip = screen.getByRole("list", { name: "GRN summary" });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /11 accepted/ })).toHaveAttribute("href", "/procurement/grn?status=accepted");
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<SummaryStrip items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("ApprovalTrail (R5: names and remarks)", () => {
  it("shows action, actor name and the quoted remark", () => {
    render(<ApprovalTrail entries={[{ actor: "N. Gupta, DDO", action: "approved", at: "2026-10-30T05:30:00Z", remarks: "Within DFP limits." }]} />);
    expect(screen.getByRole("heading", { name: "Approval trail" })).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("N. Gupta, DDO")).toBeInTheDocument();
    expect(screen.getByText("Within DFP limits.")).toBeInTheDocument();
  });

  it("says so when there is no trail yet", () => {
    render(<ApprovalTrail entries={[]} />);
    expect(screen.getByText("No approval actions recorded yet.")).toBeInTheDocument();
  });

  it("labels actions for officers", () => {
    expect(trailActionLabel("sent_back")).toBe("Returned for correction");
    expect(trailActionLabel("start")).toBe("Submitted");
    expect(trailActionLabel("charge_memo_issued")).toBe("Charge memo issued");
  });

  it("accepts localised connector and action labels", () => {
    render(<ApprovalTrail byText="द्वारा" actionText={() => "स्वीकृत"} entries={[{ actor: "N. Gupta", action: "approved" }]} />);
    expect(screen.getByText("स्वीकृत")).toBeInTheDocument();
    expect(screen.getByText(/द्वारा/)).toBeInTheDocument();
  });
});
