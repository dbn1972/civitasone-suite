import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { InstallStepSummary } from "@civitasone/types";

// next/link -> plain anchor so we can assert the retry link's href.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// DataTable (and RefreshErrorState) use next/navigation's useRouter.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { InstallStepsLog } from "./InstallStepsLog";

function step(p: Partial<InstallStepSummary> & { id: string; stepNo: number }): InstallStepSummary {
  return { title: `Step ${p.stepNo}`, isRequired: true, status: "pending", ...p } as InstallStepSummary;
}

describe("InstallStepsLog (GAP-INSTALL-STEPS-04)", () => {
  // Fails on the OLD code: the generic ModuleListPage/ModuleRowSummary mapper
  // dropped errorMessage entirely, so a failed step showed only the word
  // "failed" with no reason. This asserts the real errorMessage is rendered.
  it("renders a failed step's errorMessage, not just the status word", () => {
    const steps = [
      step({ id: "s1", stepNo: 1, status: "completed", completedAt: "2026-03-01T10:00:00Z" }),
      step({ id: "s2", stepNo: 2, status: "failed", errorMessage: "Keycloak realm import timed out" }),
    ];
    render(<InstallStepsLog steps={steps} source="api" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Keycloak realm import timed out");
  });

  // Fails on the OLD code: there was no link from the read-only list to the
  // one place that can retry a step (the wizard).
  it("links to the installer wizard to run/retry steps", () => {
    render(<InstallStepsLog steps={[step({ id: "s1", stepNo: 1, status: "failed", errorMessage: "boom" })]} source="api" />);
    const link = screen.getByRole("link", { name: /installer wizard/i });
    expect(link).toHaveAttribute("href", "/install");
  });

  // Fails on the OLD code: the generic mapper preserved no stepNo and did not
  // order by it. This asserts rows render in stepNo order even when the input
  // is out of order.
  it("orders rows by stepNo regardless of input order", () => {
    const steps = [
      step({ id: "c", stepNo: 3, title: "Third" }),
      step({ id: "a", stepNo: 1, title: "First" }),
      step({ id: "b", stepNo: 2, title: "Second" }),
    ];
    render(<InstallStepsLog steps={steps} source="api" />);
    const rows = screen.getAllByRole("row").slice(1); // drop header row
    expect(within(rows[0]).getByText("First")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Second")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Third")).toBeInTheDocument();
  });

  // Required vs optional is surfaced (dropped by the old generic mapper).
  it("marks required and optional steps", () => {
    const steps = [
      step({ id: "r", stepNo: 1, title: "Req", isRequired: true }),
      step({ id: "o", stepNo: 2, title: "Opt", isRequired: false }),
    ];
    render(<InstallStepsLog steps={steps} source="api" />);
    const rows = screen.getAllByRole("row").slice(1); // drop header row
    const reqRow = rows.find((r) => within(r).queryByText("Req"))!;
    const optRow = rows.find((r) => within(r).queryByText("Opt"))!;
    expect(within(reqRow).getByText("Required")).toBeInTheDocument();
    expect(within(optRow).getByText("Optional")).toBeInTheDocument();
  });

  it("shows a retryable error state when the load failed", () => {
    render(<InstallStepsLog steps={[]} source="error" />);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});
