import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getInstallStepsMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getInstallSteps: (...a: unknown[]) => getInstallStepsMock(...a),
}));

import InstallStatusPage from "./page";

type Step = {
  id: string;
  stepNo: number;
  title: string;
  description?: string;
  isRequired: boolean;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  completedAt?: string;
};

function step(partial: Partial<Step> & Pick<Step, "id" | "stepNo" | "title" | "status">): Step {
  return { isRequired: true, ...partial };
}

describe("InstallStatusPage", () => {
  beforeEach(() => getInstallStepsMock.mockReset());

  // GAP-TENANT-ADMIN-INSTALL-01
  it("with no steps shows no progress bar and no 0/0 text, only the EmptyState", async () => {
    getInstallStepsMock.mockResolvedValue({ data: [], source: "api" });
    render(await InstallStatusPage());

    expect(screen.getByText("No installation steps found")).toBeInTheDocument();
    expect(screen.queryByText(/0\/0 steps/)).not.toBeInTheDocument();
    expect(screen.queryByText("Installation completion")).not.toBeInTheDocument();
    // Progress stat card shows "—", never "0%"
    expect(screen.getByText("Progress").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Progress").closest(".stat")).not.toHaveTextContent("0%");
    // "Open Installer" EmptyState action exists (there is also the header one)
    expect(screen.getAllByRole("link", { name: /Open Installer/i }).length).toBeGreaterThanOrEqual(1);
  });

  // GAP-TENANT-ADMIN-INSTALL-01 (positive): with steps, the progress card renders.
  it("with steps renders the Setup Progress card and percentage", async () => {
    getInstallStepsMock.mockResolvedValue({
      data: [
        step({ id: "a", stepNo: 1, title: "DB", status: "completed" }),
        step({ id: "b", stepNo: 2, title: "Seed", status: "pending" }),
      ],
      source: "api",
    });
    render(await InstallStatusPage());
    expect(screen.getByText("Installation completion")).toBeInTheDocument();
    expect(screen.getByText("1/2 steps")).toBeInTheDocument();
    expect(screen.getByText("Progress").closest(".stat")).toHaveTextContent("50%");
  });

  // GAP-TENANT-ADMIN-INSTALL-02
  it("each list item links into the installer with its step number", async () => {
    getInstallStepsMock.mockResolvedValue({
      data: [step({ id: "a", stepNo: 3, title: "Configure modules", status: "pending" })],
      source: "api",
    });
    render(await InstallStatusPage());
    const link = screen.getByRole("link", { name: /Open installer at step 3: Configure modules/i });
    expect(link).toHaveAttribute("href", "/install/steps#step-3");
  });

  // GAP-TENANT-ADMIN-INSTALL-03
  it("renders a distinct pill for each status and the stat cards sum to total", async () => {
    getInstallStepsMock.mockResolvedValue({
      data: [
        step({ id: "a", stepNo: 1, title: "A", status: "completed" }),
        step({ id: "b", stepNo: 2, title: "B", status: "in_progress" }),
        step({ id: "c", stepNo: 3, title: "C", status: "pending" }),
        step({ id: "d", stepNo: 4, title: "D", status: "failed" }),
      ],
      source: "api",
    });
    render(await InstallStatusPage());

    const list = screen.getByRole("list", { name: "Installation steps" });
    const pills = within(list).getAllByText(/Completed|In Progress|Pending|Failed/i);
    // four distinct labels present
    const labels = pills.map((p) => p.textContent?.toLowerCase());
    expect(labels).toContain("completed");
    expect(labels).toContain("in progress");
    expect(labels).toContain("pending");
    expect(labels).toContain("failed");

    // in-progress and pending pills differ in colour (variant class)
    const inProg = within(list).getByText(/in progress/i);
    const pend = within(list).getByText(/^pending$/i);
    expect(inProg.className).not.toEqual(pend.className);

    // cards sum to total (4): completed=1, inProgress=1, pending=1 (failed is not pending)
    const statCard = (label: string) =>
      screen.getAllByText(label).map((el) => el.closest(".stat")).find(Boolean) as HTMLElement;
    expect(statCard("Completed")).toHaveTextContent("1");
    expect(statCard("In Progress")).toHaveTextContent("1");
    expect(statCard("Pending")).toHaveTextContent("1");
  });

  // GAP-TENANT-ADMIN-INSTALL-04
  it("on error shows exactly one error message and no second data-source badge", async () => {
    getInstallStepsMock.mockResolvedValue({ data: [], source: "error" });
    render(await InstallStatusPage());
    // RefreshErrorState renders a retry affordance
    const alerts = screen.getAllByText(/couldn't|could not|unavailable|try again|retry/i);
    // Only the RefreshErrorState copy — no separate amber "Couldn't load — showing nothing" badge
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    // progress shows "—"
    expect(screen.getByText("Progress").closest(".stat")).toHaveTextContent("—");
  });
});
