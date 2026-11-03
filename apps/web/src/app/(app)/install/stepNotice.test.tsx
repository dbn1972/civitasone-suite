/**
 * UAT b15 item 4: /install showed "Error: no_drafts_imported" in red with role=alert (L1 FAIL).
 *
 * That reason is set by citizen-service (packs/consumer.ts) when a Stage 3 Domain Pack activation imported zero
 * service drafts: the domain pack has no service templates for this office (none listed, or none of its service packs
 * published for the tenant). Nothing broke and nothing was written -- it is an empty result, so it is shown as a
 * notice with what to do next, not as an error. Every other step error is still shown as an error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { z } from "zod";
import type { InstallStepSummarySchema } from "@civitasone/schemas/web";
import { stepNotice, NOTHING_IMPORTED_REASON } from "./stepNotice";
import { InstallStepsLog } from "./InstallStepsLog";

type InstallStepSummary = z.infer<typeof InstallStepSummarySchema>;

vi.mock("./InstallStepActions", () => ({ InstallStepActions: () => <div data-testid="step-actions" /> }));
vi.mock("./DomainPackActivatePanel", () => ({ DomainPackActivatePanel: () => <div data-testid="domain-pack-panel" /> }));
const loaders = vi.hoisted(() => ({ getInstallSteps: vi.fn() }));
vi.mock("../../_data/loaders", () => loaders);
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => ["install_admin"],
}));
const { default: Page } = await import("./page");

const stage3 = (errorMessage: string): InstallStepSummary => ({
  id: "s3", stepNo: 3, title: "Activate domain pack", isRequired: false, status: "failed", errorMessage,
} as InstallStepSummary);

beforeEach(() => loaders.getInstallSteps.mockReset());

describe("install step notices (UAT b15 item 4)", () => {
  it("classifies no_drafts_imported as an empty result and anything else as an error", () => {
    expect(NOTHING_IMPORTED_REASON).toBe("no_drafts_imported");
    expect(stepNotice("no_drafts_imported")?.kind).toBe("nothingImported");
    expect(stepNotice("activation_failed")).toEqual({ kind: "error", text: "activation_failed" });
    expect(stepNotice(null)).toBeNull();
    expect(stepNotice("")).toBeNull();
  });

  it("/install: no_drafts_imported is a helpful notice, not an alert, with a link to the Domain Packs catalogue", async () => {
    loaders.getInstallSteps.mockResolvedValue({ data: [stage3("no_drafts_imported")], source: "api" });
    render(await Page());
    expect(screen.queryByText(/no_drafts_imported/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const note = screen.getByRole("status", { name: /no service templates were imported/i });
    expect(within(note).getByRole("link", { name: /domain packs/i })).toHaveAttribute("href", "/install/domain-packs");
  });

  it("/install: a real step error is still an alert", async () => {
    loaders.getInstallSteps.mockResolvedValue({ data: [stage3("database unreachable")], source: "api" });
    render(await Page());
    expect(screen.getByRole("alert")).toHaveTextContent("Error: database unreachable");
  });

  it("/install/steps log: the same notice in the Detail column", () => {
    render(<InstallStepsLog steps={[stage3("no_drafts_imported")] as never} source="api" />);
    expect(screen.queryByText(/no_drafts_imported/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.getAllByText(/no service templates were imported/i).length).toBeGreaterThan(0);
  });
});
