import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContractorRow } from "./ContractorRow";

const BASE = {
  name: "Ravi Sharma",
  agency: "Infosys BPO Ltd",
  department: "IT Division",
  designation: "Data Entry Operator",
  contractFrom: "01/04/2026",
  contractTo: "31/03/2027",
  status: "active",
};

describe("ContractorRow", () => {
  it("renders name, agency and department", () => {
    render(
      <table><tbody><ContractorRow {...BASE} /></tbody></table>
    );
    expect(screen.getByText("Ravi Sharma")).toBeInTheDocument();
    expect(screen.getByText("Infosys BPO Ltd")).toBeInTheDocument();
    expect(screen.getByText("IT Division")).toBeInTheDocument();
  });

  it("renders contract dates", () => {
    render(
      <table><tbody><ContractorRow {...BASE} /></tbody></table>
    );
    expect(screen.getByText("01/04/2026")).toBeInTheDocument();
  });

  it("renders status", () => {
    render(
      <table><tbody><ContractorRow {...BASE} /></tbody></table>
    );
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it("shows expiry warning for contracts ending within 30 days", () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const dd = String(soon.getDate()).padStart(2, "0");
    const mm = String(soon.getMonth() + 1).padStart(2, "0");
    const yyyy = soon.getFullYear();
    render(
      <table><tbody><ContractorRow {...BASE} contractTo={`${dd}/${mm}/${yyyy}`} /></tbody></table>
    );
    expect(screen.getByLabelText(/expires in/i)).toBeInTheDocument();
  });

  it("shows expired label for past contracts", () => {
    render(
      <table><tbody><ContractorRow {...BASE} contractTo="01/01/2020" /></tbody></table>
    );
    expect(screen.getByLabelText(/contract expired/i)).toBeInTheDocument();
  });

  it("has accessible row aria-label", () => {
    render(
      <table><tbody><ContractorRow {...BASE} /></tbody></table>
    );
    expect(screen.getByRole("row", { name: /Ravi Sharma/i })).toBeInTheDocument();
  });
});
