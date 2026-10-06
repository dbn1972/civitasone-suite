import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ScheduledTable, type ScheduledRow } from "./ScheduledTable";

const ID = "11111111-0000-4000-8000-000000000001";
const ROW: ScheduledRow = {
  id: ID,
  templateId: "3f2a9c1b-0000-4000-8000-000000000001",
  templateName: "Monthly Collection Summary",
  cadence: "monthly",
  recipients: ["alice@example.com", "bob@example.com", "carol@example.com"],
  format: "pdf",
  enabled: true,
  nextRunAt: "2026-10-05T03:30:00.000Z", // 09:00 IST
  version: 2,
};

describe("ScheduledTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("GAP-REPORTS-SCHEDULED-01: shows the template name, not a sliced UUID", () => {
    render(<ScheduledTable rows={[ROW]} />);
    expect(screen.getByText("Monthly Collection Summary")).toBeInTheDocument();
    expect(screen.queryByText(/3f2a9c1b…/)).not.toBeInTheDocument();
  });

  it("GAP-REPORTS-SCHEDULED-04: shows the first recipient plus a +N more, with the full list in a title", () => {
    render(<ScheduledTable rows={[ROW]} />);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    const cell = screen.getByText("alice@example.com").closest("span");
    expect(cell?.getAttribute("title")).toBe("alice@example.com, bob@example.com, carol@example.com");
  });

  it("GAP-REPORTS-SCHEDULED-05: renders Next Run in IST via the shared formatter", () => {
    render(<ScheduledTable rows={[ROW]} />);
    // 2026-10-05T03:30:00Z -> 09:00 IST on 05 Oct 2026.
    expect(screen.getByText(/05 Oct 2026/)).toBeInTheDocument();
  });

  it("GAP-REPORTS-SCHEDULED-04: toggling Disable PATCHes enabled:false with the version and refreshes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: ID } }), { status: 202 }),
    );
    render(<ScheduledTable rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable schedule" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`/api/proxy/v1/reports/scheduled/${ID}`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ enabled: false, version: 2 });
  });

  it("GAP-REPORTS-SCHEDULED-04: Delete confirms then DELETEs and refreshes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: ID } }), { status: 202 }),
    );
    render(<ScheduledTable rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Confirm dialog opens; type a reason, then confirm.
    await waitFor(() => expect(screen.getByText(/Delete the .Monthly Collection Summary. schedule\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "No longer required" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]!);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`/api/proxy/v1/reports/scheduled/${ID}`);
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("GAP-REPORTS-SCHEDULED-04: Run now confirms then POSTs to /:id/run", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "job" } }), { status: 202 }),
    );
    render(<ScheduledTable rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(screen.getByText(/Run .Monthly Collection Summary. now\?/)).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Run now" })[1]!);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`/api/proxy/v1/reports/scheduled/${ID}/run`);
    expect((init as RequestInit).method).toBe("POST");
  });
});
