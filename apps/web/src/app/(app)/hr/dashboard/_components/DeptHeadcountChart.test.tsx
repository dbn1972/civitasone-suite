import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeptHeadcountChart } from "./DeptHeadcountChart";

const BREAKDOWN = [{ name: "Finance", count: 10 }, { name: "IT", count: 4 }];

describe("DeptHeadcountChart (GAP-HR-DASHBOARD-08)", () => {
  it("renders no scope note by default", () => {
    render(<DeptHeadcountChart breakdown={BREAKDOWN} />);
    expect(screen.queryByText(/organisation-wide/i)).not.toBeInTheDocument();
  });

  it("renders the scope note when passed, without changing the rendered breakdown", () => {
    render(<DeptHeadcountChart breakdown={BREAKDOWN} scopeNote="Organisation-wide" />);
    expect(screen.getByText(/organisation-wide/i)).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("IT")).toBeInTheDocument();
  });
});
