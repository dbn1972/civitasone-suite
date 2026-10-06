import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { CaseSelector } from "./CaseSelector";
import type { CourtCase } from "../_data/types";

const c1: CourtCase = {
  id: "case-1",
  cnrNumber: "DLHC010000012026",
  caseType: "civil",
  filingNumber: "F/1/2026",
  filingDate: "2026-01-05",
  title: "State vs. Sharma",
  status: "pending",
  stage: null,
  courtId: "court-1",
  benchId: null,
  disposalDate: null,
  targetDisposalDate: null,
  version: 1,
};

describe("CaseSelector", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it("renders a genuine empty state when there are no cases and the fetch succeeded", () => {
    render(<CaseSelector cases={[]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.getByText("No cases to pick from")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("renders the saved-information badge (not the register-a-case copy) when the cases fetch failed", () => {
    render(<CaseSelector cases={[]} casesSource="error" basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your cases")).toBeInTheDocument();
    expect(screen.queryByText("No cases to pick from")).not.toBeInTheDocument();
  });

  it("renders the saved-information badge even if a stale (non-empty) case list is passed alongside an error source", () => {
    render(<CaseSelector cases={[c1]} casesSource="error" basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.queryByLabelText("Case")).not.toBeInTheDocument();
  });

  it("lists cases and navigates to the base path with the chosen caseId", () => {
    render(<CaseSelector cases={[c1]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    const input = screen.getByLabelText("Case");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Sharma" } });
    // Pick the filtered option (role=option → button).
    fireEvent.mouseDown(screen.getByRole("option", { name: /State vs\. Sharma/ }).querySelector("button")!);
    expect(pushMock).toHaveBeenCalledWith("/court/hearings?caseId=case-1");
  });

  it("filters options as the user types (searchable combobox)", () => {
    const c2: CourtCase = { ...c1, id: "case-2", title: "Rao v. State", cnrNumber: "DLHC020000022026" };
    render(<CaseSelector cases={[c1, c2]} casesSource="api" basePath="/court/orders" selectedCaseId="" />);
    const input = screen.getByLabelText("Case");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Rao" } });
    expect(screen.getByRole("option", { name: /Rao v\. State/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /State vs\. Sharma/ })).not.toBeInTheDocument();
  });
});
