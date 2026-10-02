import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminRegister, type RegisterStat } from "./AdminRegister";

const stats: RegisterStat[] = [
  { icon: "i", iconBg: "#fff", label: "Total", value: 3 },
  { icon: "i", iconBg: "#fff", label: "Paid", value: 1 },
  { icon: "i", iconBg: "#fff", label: "Other", value: 0, onlyWhenPositive: true },
];

// GAP-ADMIN-INVOICES-03/-04 (shared by metering/onboarding/operators)
describe("AdminRegister", () => {
  it("shows the stats and table for live data, with no zero-valued optional card", () => {
    render(<AdminRegister title="T" area="things" stats={stats} provenance="live"><p>table body</p></AdminRegister>);
    expect(screen.getByText("Total").parentElement).toHaveTextContent("3");
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
    expect(screen.getByText("table body")).toBeInTheDocument();
  });

  it("cached data keeps the cards (computed by the caller from the cached rows) and the saved-data badge", () => {
    render(<AdminRegister title="T" area="things" stats={stats} provenance="cached" cachedAt={null}><p>table body</p></AdminRegister>);
    expect(screen.getByText("Total").parentElement).toHaveTextContent("3");
    expect(screen.getByRole("status")).toHaveTextContent(/saved data/i);
    expect(screen.getByText("table body")).toBeInTheDocument();
  });

  it("error-no-data: every card reads an em dash, a Retry is offered, and the table is not rendered", () => {
    render(<AdminRegister title="T" area="things" stats={stats} provenance="error-no-data" errorStatus={500}><p>table body</p></AdminRegister>);
    expect(screen.getByText("Total").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Paid").parentElement).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("table body")).not.toBeInTheDocument();
  });

  it("error-no-data with a 403 renders access-restricted, not a retry", () => {
    render(<AdminRegister title="T" area="things" stats={stats} provenance="error-no-data" errorStatus={403}><p>table body</p></AdminRegister>);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
