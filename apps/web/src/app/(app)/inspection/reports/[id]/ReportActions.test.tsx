import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { ReportActions } from "./ReportActions";

// UAT Phase 2 C3 (J13): the report workflow calls inspection-service's routes.
const ID = "aaaaaaaa-1111-4000-8000-000000000001";
function mockFetch(status = 202) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify(status === 202 ? { data: { id: ID, status: "accepted" } } : { code: "SOD_VIOLATION", message: "raw" }), { status }));
}
const calls = (spy: ReturnType<typeof mockFetch>) => spy.mock.calls.map(([u, init]) => [String(u), (init as RequestInit)?.method, (init as RequestInit)?.body]);

beforeEach(() => vi.restoreAllMocks());

describe("ReportActions", () => {
  it("Submit for review POSTs /reports/:id/submit after confirmation", async () => {
    const spy = mockFetch();
    render(<ReportActions reportId={ID} canSubmit canApprove={false} isOwnReport canObserve={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(calls(spy)).toContainEqual([`/api/proxy/v1/inspection/reports/${ID}/submit`, "POST", undefined]));
  });

  it("Approve POSTs /reports/:id/approve", async () => {
    const spy = mockFetch();
    render(<ReportActions reportId={ID} canSubmit={false} canApprove isOwnReport={false} canObserve={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve report" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve report" }));
    await waitFor(() => expect(calls(spy)).toContainEqual([`/api/proxy/v1/inspection/reports/${ID}/approve`, "POST", undefined]));
  });

  it("Add observation validates, then POSTs the observation", async () => {
    const spy = mockFetch();
    render(<ReportActions reportId={ID} canSubmit={false} canApprove={false} isOwnReport canObserve />);
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    expect(await screen.findByText("Enter a category and a description.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "Safety" } });
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: "Exit blocked" } });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe(`/api/proxy/v1/inspection/reports/${ID}/observations`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ category: "Safety", severity: "critical", description: "Exit blocked" });
  });
});
