import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@/app/_components/ds/Toast";
import type { ReactElement } from "react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { IssuesTable, type IssuesTableRow } from "./IssuesTable";

function withToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const ROWS: IssuesTableRow[] = [
  {
    id: "11111111-2222-3333-4444-555555555555",
    workId: "work-abc",
    work: "W-2025-014",
    description: "Crack in the retaining wall",
    raisedDate: "01 Jan 2026",
    status: "open",
  },
];

describe("IssuesTable (GAP-WORKS-EXECUTION-ISSUES-01/02/03/04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("ISSUES-03: has no Priority column", () => {
    withToast(<IssuesTable rows={ROWS} canClose />);
    expect(screen.queryByText("Priority")).toBeNull();
  });

  it("ISSUES-02: a row links to its work by workId", () => {
    const { container } = withToast(<IssuesTable rows={ROWS} canClose={false} />);
    const link = container.querySelector('a[href="/works/execution/work-abc"]');
    expect(link).not.toBeNull();
  });

  it("ISSUES-04: Close is hidden for a read-only role", () => {
    withToast(<IssuesTable rows={ROWS} canClose={false} />);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("ISSUES-01/04: clicking Close requires a resolution note, then POSTs to that row's id (no UUID typed)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    withToast(<IssuesTable rows={ROWS} canClose />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Close Issue" });
    // Required resolution gates confirm.
    expect(confirm).toBeDisabled();

    const reason = within(dialog).getByRole("textbox");
    fireEvent.change(reason, { target: { value: "Wall re-grouted and inspected." } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      const post = fetchSpy.mock.calls.find(([u]) => String(u).includes("/issues/"));
      expect(post).toBeTruthy();
      expect(String(post![0])).toContain("/issues/11111111-2222-3333-4444-555555555555/close");
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.resolution).toBe("Wall re-grouted and inspected.");
    });
  });
});
