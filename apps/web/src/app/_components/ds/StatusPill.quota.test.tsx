import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

// GAP-TENANT-QUOTAS-02: near_limit -> amber "Near limit"; exceeded -> red; an
// unknown snake_case value is humanised instead of printed raw.
describe("StatusPill quota statuses (GAP-TENANT-QUOTAS-02)", () => {
  it("near_limit renders Near Limit with the amber (warn) pill", () => {
    render(<StatusPill status="near_limit" />);
    expect(screen.getByText("Near Limit")).toHaveClass("pill", "warn");
  });

  it("'Near limit' (as emitted by mapQuotaRows) is also amber", () => {
    render(<StatusPill status="Near limit" />);
    expect(screen.getByText("Near Limit")).toHaveClass("warn");
  });

  it("Exceeded is red and OK is green (humanised to Ok)", () => {
    render(
      <>
        <StatusPill status="Exceeded" />
        <StatusPill status="OK" />
      </>,
    );
    expect(screen.getByText("Exceeded")).toHaveClass("bad");
    expect(screen.getByText("Ok")).toHaveClass("good");
  });

  it("an unknown snake_case value is humanised, not printed raw", () => {
    render(<StatusPill status="foo_bar" />);
    expect(screen.getByText("Foo Bar")).toBeInTheDocument();
  });
});
