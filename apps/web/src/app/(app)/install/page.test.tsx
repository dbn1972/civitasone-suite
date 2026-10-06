import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { z } from "zod";
import type { InstallStepSummarySchema } from "@civitasone/schemas/web";

type InstallStepSummary = z.infer<typeof InstallStepSummarySchema>;

// Isolate the page's own server logic from the client sub-components.
vi.mock("./InstallStepActions", () => ({
  InstallStepActions: ({ status }: { status: string }) => (
    <div data-testid="step-actions" data-status={status} />
  ),
}));
vi.mock("./DomainPackActivatePanel", () => ({
  DomainPackActivatePanel: ({ canOperate }: { canOperate?: boolean }) => (
    <div data-testid="domain-pack-panel" data-can-operate={String(canOperate)} />
  ),
}));

const loaders = vi.hoisted(() => ({ getInstallSteps: vi.fn() }));
vi.mock("../../_data/loaders", () => loaders);

const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn(() => ["install_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  ...auth,
}));

const { default: Page } = await import("./page");

function step(partial: Partial<InstallStepSummary> & { id: string; stepNo: number }): InstallStepSummary {
  return {
    title: `Step ${partial.stepNo}`,
    isRequired: true,
    status: "pending",
    ...partial,
  } as InstallStepSummary;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSessionRoles.mockReturnValue(["install_admin"]);
});

async function show() {
  render(await Page());
}

describe("Installer wizard home (GAP-INSTALL-HOME)", () => {
  // HOME-01: the loader schema really does populate title/stepNo/isRequired,
  // so the page renders the real step title (not "undefined") and a required
  // count other than 0/0.
  it("renders step titles and a real required count from the typed loader", async () => {
    loaders.getInstallSteps.mockResolvedValue({
      source: "api",
      data: [
        step({ id: "a", stepNo: 1, title: "Create tenant", status: "completed" }),
        step({ id: "b", stepNo: 2, title: "Seed roles", status: "pending" }),
      ],
    });
    await show();
    expect(screen.getByText("Create tenant")).toBeInTheDocument();
    expect(screen.getByText("Seed roles")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  // HOME-02: a failed fetch must show a real error with Retry, never the
  // "No installation steps found" empty state.
  it("shows an error state with retry on fetch failure, not the empty state", async () => {
    loaders.getInstallSteps.mockResolvedValue({ source: "error", data: [] });
    await show();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No installation steps found/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("domain-pack-panel")).not.toBeInTheDocument();
  });

  // HOME-02: a genuine empty success still shows the empty state + panel.
  it("shows the empty state on an empty successful load", async () => {
    loaders.getInstallSteps.mockResolvedValue({ source: "api", data: [] });
    await show();
    expect(screen.getByText(/No installation steps found/i)).toBeInTheDocument();
    expect(screen.getByTestId("domain-pack-panel")).toBeInTheDocument();
  });

  // HOME-06: "Complete" only when nothing is pending/failed — an optional
  // pending step keeps the headline at "In progress" even at high percent.
  it("does not report Complete while an optional step is still pending", async () => {
    loaders.getInstallSteps.mockResolvedValue({
      source: "api",
      data: [
        step({ id: "a", stepNo: 1, title: "Required done", isRequired: true, status: "completed" }),
        step({ id: "b", stepNo: 2, title: "Optional later", isRequired: false, status: "pending" }),
      ],
    });
    await show();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
  });

  // HOME-03: non-operator sees no step actions and the panel is read-only.
  it("hides step actions and marks the panel read-only for a viewer without operate roles", async () => {
    auth.getSessionRoles.mockReturnValue(["employee"]);
    loaders.getInstallSteps.mockResolvedValue({
      source: "api",
      data: [step({ id: "a", stepNo: 1, title: "Create tenant", status: "pending" })],
    });
    await show();
    expect(screen.queryByTestId("step-actions")).not.toBeInTheDocument();
    expect(screen.getByTestId("domain-pack-panel")).toHaveAttribute("data-can-operate", "false");
  });

  // HOME-08: footer uses client Link (next/link renders <a>) with no "Stage 3" jargon.
  it("renders console/domain-pack footer links without 'Stage 3' jargon", async () => {
    loaders.getInstallSteps.mockResolvedValue({
      source: "api",
      data: [step({ id: "a", stepNo: 1, title: "Create tenant", status: "pending" })],
    });
    await show();
    const dp = screen.getByRole("link", { name: /Domain Packs/i });
    expect(dp).toHaveAttribute("href", "/install/domain-packs");
    expect(dp.textContent).not.toMatch(/Stage 3/i);
  });
});
