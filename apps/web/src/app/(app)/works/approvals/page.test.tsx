import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const aaMock = vi.fn();
const tsMock = vi.fn();
// GAP2-WORKS-APPROVALS-05: the page now also fetches the true register totals
// so the table can show real counts + a truncation notice. Stub them here.
const aaMetaMock = vi.fn();
const tsMetaMock = vi.fn();
vi.mock("../_data/loaders", () => ({
  getApprovalsAa: () => aaMock(),
  getApprovalsTs: () => tsMock(),
  getApprovalsAaMeta: () => aaMetaMock(),
  getApprovalsTsMeta: () => tsMetaMock(),
}));

const rolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/roleGuard")>();
  return { ...orig, getSessionRoles: () => rolesMock() };
});

// The client table isn't under test here; stub it so the page renders in jsdom.
vi.mock("./ApprovalsTable", () => ({
  ApprovalsTable: () => <div data-testid="approvals-table" />,
}));

import ApprovalsPage from "./page";

describe("ApprovalsPage — create actions are role-gated (GAP-WORKS-APPROVALS-05)", () => {
  beforeEach(() => {
    aaMock.mockReset();
    tsMock.mockReset();
    rolesMock.mockReset();
    aaMock.mockResolvedValue({ data: [], source: "api" });
    tsMock.mockResolvedValue({ data: [], source: "api" });
    aaMetaMock.mockReset();
    tsMetaMock.mockReset();
    aaMetaMock.mockResolvedValue({ data: { total: 0, fetched: 0 }, source: "api" });
    tsMetaMock.mockResolvedValue({ data: { total: 0, fetched: 0 }, source: "api" });
  });

  it("hides + New AA / + New TS for a read-only role", async () => {
    rolesMock.mockReturnValue(["works_viewer"]);
    const ui = await ApprovalsPage();
    render(ui);
    expect(screen.queryByRole("link", { name: "+ New AA" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ New TS" })).not.toBeInTheDocument();
  });

  it("shows both create links for a works write role", async () => {
    rolesMock.mockReturnValue(["works_operator"]);
    const ui = await ApprovalsPage();
    render(ui);
    expect(screen.getByRole("link", { name: "+ New AA" })).toHaveAttribute("href", "/works/approvals/new");
    expect(screen.getByRole("link", { name: "+ New TS" })).toHaveAttribute("href", "/works/approvals/ts-new");
  });
});
