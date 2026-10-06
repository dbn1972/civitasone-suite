import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
const rolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import IssuesRegisterPage from "./page";

describe("IssuesRegisterPage (GAP-WORKS-EXECUTION-ISSUES-05 / role gate)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
  });

  it("ISSUES-05: header has a Raise issue link", async () => {
    rolesMock.mockReturnValue(["works_viewer"]);
    fetchJsonMock.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });
    render(await IssuesRegisterPage());
    const link = screen.getByRole("link", { name: /Raise issue/i });
    expect(link).toHaveAttribute("href", "/works/execution/issues/new");
  });

  it("ISSUES-05: shows 'first N of M' when the list is truncated", async () => {
    rolesMock.mockReturnValue(["works_viewer"]);
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `i${i}`, workId: "w", description: "x", status: "open",
    }));
    fetchJsonMock.mockResolvedValue({ data: { rows, total: 150 }, source: "api" });
    render(await IssuesRegisterPage());
    expect(screen.getByText(/first 100 of 150/i)).toBeInTheDocument();
  });

  it("ISSUES-04: a read-only role sees no Close button", async () => {
    rolesMock.mockReturnValue(["works_viewer"]);
    fetchJsonMock.mockResolvedValue({
      data: { rows: [{ id: "i1", workId: "w", description: "x", status: "open" }], total: 1 },
      source: "api",
    });
    render(await IssuesRegisterPage());
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("ISSUES-04: a works_operator sees the Close control", async () => {
    rolesMock.mockReturnValue(["works_operator"]);
    fetchJsonMock.mockResolvedValue({
      data: { rows: [{ id: "i1", workId: "w", description: "x", status: "open" }], total: 1 },
      source: "api",
    });
    render(await IssuesRegisterPage());
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
