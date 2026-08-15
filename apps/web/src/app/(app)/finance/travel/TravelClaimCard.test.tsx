import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TravelClaimCard, type TravelClaimCardProps } from "./TravelClaimCard";

const BASE: TravelClaimCardProps = {
  id: "tc1",
  employeeName: "Neha Kapoor",
  employeeNo: "EMP042",
  payLevel: 10,
  from: "New Delhi",
  to: "Mumbai",
  departureDate: "2026-08-01",
  returnDate: "2026-08-03",
  purpose: "Departmental Review Meeting",
  fareClass: "AC-II",
  fareAmount: 320000,
  daAmount: 80000,
  hotelAmount: 150000,
  hotelNights: 2,
  totalAmount: 550000,
  auditStatus: "Pending",
};

describe("TravelClaimCard", () => {
  it("renders employee name and number", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.getByText(/Neha Kapoor/)).toBeInTheDocument();
    expect(screen.getByText(/EMP042/)).toBeInTheDocument();
  });

  it("renders route from → to", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.getByText(/New Delhi.*Mumbai/)).toBeInTheDocument();
  });

  it("renders departure and return dates", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
    expect(screen.getByText("2026-08-03")).toBeInTheDocument();
  });

  it("displays pay level and purpose", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.getByText(/Pay Level 10/)).toBeInTheDocument();
    expect(screen.getByText(/Departmental Review Meeting/)).toBeInTheDocument();
  });

  it("shows fare class", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.getByText("AC-II")).toBeInTheDocument();
  });

  it("shows warning icon when fare class exceeds entitlement", () => {
    // Pay Level 10 entitlement is AC-III; claiming AC-I exceeds it
    render(<TravelClaimCard {...BASE} fareClass="AC-I" />);
    expect(screen.getByRole("generic", { name: /Fare class exceeds entitlement/i })).toBeInTheDocument();
  });

  it("does not show warning when fare class equals entitlement", () => {
    // Pay Level 10 entitlement is AC-III; claiming AC-III is fine
    render(<TravelClaimCard {...BASE} payLevel={10} fareClass="AC-III" />);
    expect(screen.queryByLabelText(/Fare class exceeds entitlement/i)).not.toBeInTheDocument();
  });

  it("renders hotel stay details", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.getByText(/2 night/)).toBeInTheDocument();
  });

  it("renders total claim amount formatted in INR", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.getByText(/₹5,500/)).toBeInTheDocument();
  });

  it("renders audit status via StatusPill", () => {
    render(<TravelClaimCard {...BASE} auditStatus="Under Audit" />);
    expect(screen.getByText("Under Audit")).toBeInTheDocument();
  });

  it("shows audit remark when present", () => {
    render(<TravelClaimCard {...BASE} auditStatus="Rejected" auditRemark="Receipt missing" />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/Receipt missing/)).toBeInTheDocument();
  });

  it("does not render remark section when no remark", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("renders as article landmark", () => {
    render(<TravelClaimCard {...BASE} />);
    expect(screen.getByRole("article", { name: /Travel claim tc1/i })).toBeInTheDocument();
  });
});
