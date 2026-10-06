import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TestRunPanel } from "./TestRunPanel";

describe("TestRunPanel", () => {
  it("expands fail rows with three-part error and deep-link", () => {
    render(
      <TestRunPanel
        definitionId="def-1"
        steps={[
          {
            id: "demand",
            label: "Fee demand lines",
            status: "fail",
            error: "Head of Account (HOA) is not set.",
            why: "Demand lines require an HOA for GL posting.",
            next: "Select an HOA in the Fee block before submitting.",
            blockLink: "/designer/def-1/b5#hoaCode",
          },
        ]}
        history={[]}
        onRun={vi.fn()}
      />,
    );

    expect(screen.getByText(/must pass this test/i)).toBeInTheDocument();
    expect(screen.getByText("What happened")).toBeInTheDocument();
    expect(screen.getByText(/Head of Account \(HOA\) is not set/i)).toBeInTheDocument();
    expect(screen.getByText(/require an HOA/i)).toBeInTheDocument();
    expect(screen.getByText(/Select an HOA/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to block/i })).toHaveAttribute(
      "href",
      "/designer/def-1/b5#hoaCode",
    );
  });

  it("shows demand line artifacts on pass steps", () => {
    render(
      <TestRunPanel
        definitionId="def-1"
        steps={[
          {
            id: "demand",
            label: "Fee demand lines",
            status: "pass",
            artifacts: {
              sampleLines: [{ label: "Base fee", amountMinor: 50000, taxHeadCode: "BASE" }],
            },
          },
        ]}
        history={[]}
      />,
    );
    expect(screen.getByText("Demand lines")).toBeInTheDocument();
    expect(screen.getByText(/Base fee/)).toBeInTheDocument();
  });

  it("invokes onRun from the primary button", () => {
    const onRun = vi.fn();
    render(
      <TestRunPanel definitionId="def-1" steps={[]} history={[]} onRun={onRun} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run sandbox test/i }));
    expect(onRun).toHaveBeenCalled();
  });

  // GAP-DESIGNER-DETAIL-TEST-05: empty or invalid createdAt prints em-dash, never "Invalid Date".
  it("renders a dash for empty or invalid createdAt, not Invalid Date", () => {
    render(
      <TestRunPanel
        definitionId="def-1"
        steps={[]}
        history={[
          { id: "r1", status: "pass", durationMs: 120, createdAt: "" },
          { id: "r2", status: "fail", durationMs: null, createdAt: "not-a-date" },
          { id: "r3", status: "pass", durationMs: 80, createdAt: "2026-09-28T12:00:00Z" },
        ]}
        onRun={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    // The valid row should render a real locale string.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});
