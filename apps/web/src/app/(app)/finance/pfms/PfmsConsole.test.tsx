import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PfmsConsole } from "./PfmsConsole";
import type { PfmsBatchRow } from "./types";

const batches: PfmsBatchRow[] = [
  {
    id: "b1", pfmsId: "PFMS-0001", type: "salary", amountMinor: "150000000",
    agencyCode: "AG01", schemeCode: "SCH01", ddoCode: "DDO01",
    submissionStatus: "pending", signedAt: null,
  },
];

describe("PfmsConsole", () => {
  it("shows the Batches tab by default", () => {
    render(<PfmsConsole batches={batches} config={{ agencyCode: "AG01", defaultDdo: "DDO01" }} />);
    expect(screen.getByText("PFMS-0001")).toBeInTheDocument();
  });

  it("switches to the Config tab", () => {
    render(<PfmsConsole batches={batches} config={{ agencyCode: "AG01", defaultDdo: "DDO01" }} />);
    fireEvent.click(screen.getByText("Config"));
    expect(screen.getByText("AG01")).toBeInTheDocument();
  });

  it("switches to the Payments tab", () => {
    render(<PfmsConsole batches={batches} config={null} />);
    fireEvent.click(screen.getByText("Payments"));
    expect(screen.getByText("Submit Payment to PFMS")).toBeInTheDocument();
  });
});
