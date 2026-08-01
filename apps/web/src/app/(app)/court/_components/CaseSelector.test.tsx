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

  it("renders an empty state when there are no cases", () => {
    render(<CaseSelector cases={[]} basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.getByText("No cases to pick from")).toBeInTheDocument();
  });

  it("lists cases and navigates to the base path with the chosen caseId", () => {
    render(<CaseSelector cases={[c1]} basePath="/court/hearings" selectedCaseId="" />);
    fireEvent.change(screen.getByLabelText("Case"), { target: { value: "case-1" } });
    expect(pushMock).toHaveBeenCalledWith("/court/hearings?caseId=case-1");
  });

  it("navigates back to the bare base path when cleared", () => {
    render(<CaseSelector cases={[c1]} basePath="/court/orders" selectedCaseId="case-1" />);
    fireEvent.change(screen.getByLabelText("Case"), { target: { value: "" } });
    expect(pushMock).toHaveBeenCalledWith("/court/orders");
  });
});
