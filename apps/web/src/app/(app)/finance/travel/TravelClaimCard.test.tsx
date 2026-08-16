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
  fareClass: "AC-I",
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
    expect(screen.getByText("AC-I")).toBeInTheDocument();
  });

  it("shows warning icon when fare class exceeds entitlement", () => {
    // Pay Level 10 entitlement is AC-I (CCS(TA) Rules 1988); claiming Business exceeds it
    render(<TravelClaimCard {...BASE} fareClass="Business" />);
    expect(screen.getByRole("generic", { name: /Fare class exceeds entitlement/i })).toBeInTheDocument();
  });

  it("does not show warning when fare class equals entitlement", () => {
    // Pay Level 10 entitlement is AC-I (CCS(TA) Rules 1988); claiming AC-I is within entitlement
    render(<TravelClaimCard {...BASE} payLevel={10} fareClass="AC-I" />);
    expect(screen.queryByLabelText(/Fare class exceeds entitlement/i)).not.toBeInTheDocument();
  });

  it("shows Sleeper entitlement for Level 3 employee (CCS(TA) Rules 1988 Second Schedule)", () => {
    // Level 1–5 are entitled to Sleeper Class per CCS(TA) Rules 1988
    render(<TravelClaimCard {...BASE} payLevel={3} fareClass="Sleeper" />);
    // Sleeper is the entitled class — no warning expected
    expect(screen.queryByLabelText(/Fare class exceeds entitlement/i)).not.toBeInTheDocument();
    // The entitlement tooltip confirms Sleeper for pay level 3
    const span = screen.getByTitle(/Entitlement for Pay Level 3: Sleeper/i);
    expect(span).toBeInTheDocument();
  });

  it("shows AC-I entitlement for Level 11 employee (CCS(TA) Rules 1988 Second Schedule)", () => {
    // Level 9–17 are entitled to AC-I Tier per CCS(TA) Rules 1988
    render(<TravelClaimCard {...BASE} payLevel={11} fareClass="AC-I" />);
    // AC-I is the entitled class — no warning expected
    expect(screen.queryByLabelText(/Fare class exceeds entitlement/i)).not.toBeInTheDocument();
    // The entitlement tooltip confirms AC-I for pay level 11
    const span = screen.getByTitle(/Entitlement for Pay Level 11: AC-I/i);
    expect(span).toBeInTheDocument();
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
