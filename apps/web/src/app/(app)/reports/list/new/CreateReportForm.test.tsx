import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { CreateReportForm } from "./CreateReportForm";

describe("CreateReportForm (GAP-REPORTS-LIST-NEW-03)", () => {
  it("report type is a <select> of known modules, not a free-text input", () => {
    render(<CreateReportForm />);
    const control = screen.getByLabelText("Report type / module");
    expect(control.tagName).toBe("SELECT");
    // Known options present
    expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "KPI target" })).toBeInTheDocument();
  });

  it("an unknown defaultReportType falls back to the General option", () => {
    render(<CreateReportForm defaultReportType="Finanace" />);
    const control = screen.getByLabelText("Report type / module") as HTMLSelectElement;
    expect(control.value).toBe("");
  });
});
