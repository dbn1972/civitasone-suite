import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintHeader } from "./PrintHeader";

describe("PrintHeader (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-05)", () => {
  it("names the document, scope and generation time, and disclaims being an official statement", () => {
    render(<PrintHeader title="Financial Statements" scope="Cumulative, all periods" />);
    expect(screen.getByRole("heading", { name: "Financial Statements" })).toBeInTheDocument();
    const meta = screen.getByTestId("fin-print-header");
    expect(meta).toHaveTextContent("Cumulative, all periods");
    expect(meta).toHaveTextContent(/Generated .* IST/);
    expect(meta).toHaveTextContent(/not an official/);
  });
});
