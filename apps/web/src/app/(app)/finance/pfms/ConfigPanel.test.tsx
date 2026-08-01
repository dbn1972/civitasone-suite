import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfigPanel } from "./ConfigPanel";

describe("ConfigPanel", () => {
  it("renders the tenant's PFMS configuration", () => {
    render(<ConfigPanel config={{ agencyCode: "AG01", defaultDdo: "DDO01" }} />);
    expect(screen.getByText("AG01")).toBeInTheDocument();
    expect(screen.getByText("DDO01")).toBeInTheDocument();
  });

  it("renders an empty state when no configuration is set, without fabricating data", () => {
    render(<ConfigPanel config={null} />);
    expect(screen.getByText("No PFMS configuration set")).toBeInTheDocument();
  });

  it("renders an empty state when config exists but has no values", () => {
    render(<ConfigPanel config={{ agencyCode: null, defaultDdo: null }} />);
    expect(screen.getByText("No PFMS configuration set")).toBeInTheDocument();
  });
});
