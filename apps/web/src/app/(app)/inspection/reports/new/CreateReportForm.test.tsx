import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import { CreateReportForm } from "./CreateReportForm";

// UAT Phase 2 C3 (J13): raise an inspection report against an inspection.
const INSP = { id: "cccccccc-1111-4000-8000-000000000001", entityId: "dddddddd-1111-4000-8000-000000000001", state: "completed", scheduledDate: "2026-10-30" };

function mockFetch(post?: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/inspection/inspections")) return new Response(JSON.stringify({ data: [INSP], meta: { total: 1 } }), { status: 200 });
    if (url.includes("/inspection/reports") && (init as RequestInit | undefined)?.method === "POST") {
      return post ?? new Response(JSON.stringify({ data: { id: "rep-1", status: "accepted" } }), { status: 202 });
    }
    return new Response(null, { status: 404 });
  });
}
const posted = (spy: ReturnType<typeof mockFetch>) =>
  spy.mock.calls.find(([i, init]) => String(i).includes("/inspection/reports") && (init as RequestInit)?.method === "POST");

beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

describe("CreateReportForm", () => {
  it("refuses to submit without an inspection", async () => {
    const spy = mockFetch();
    render(<CreateReportForm />);
    await screen.findByRole("option", { name: /cccccccc/ });
    fireEvent.click(screen.getByRole("button", { name: "Create report" }));
    expect(await screen.findByText("Choose the inspection this report is for.")).toBeInTheDocument();
    expect(posted(spy)).toBeUndefined();
  });

  it("posts the chosen inspection with ITS entity, type, grade and text, then returns to the register", async () => {
    const spy = mockFetch();
    render(<CreateReportForm />);
    await screen.findByRole("option", { name: /cccccccc/ });
    fireEvent.change(screen.getByLabelText(/^Inspection/), { target: { value: INSP.id } });
    fireEvent.change(screen.getByLabelText("Report type"), { target: { value: "surprise" } });
    fireEvent.change(screen.getByLabelText("Overall grade"), { target: { value: "C" } });
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "  Fire exits blocked  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create report" }));
    await waitFor(() => expect(posted(spy)).toBeTruthy());
    const body = JSON.parse(String((posted(spy)![1] as RequestInit).body));
    expect(body).toEqual({ inspectionId: INSP.id, entityId: INSP.entityId, reportType: "surprise", overallGrade: "C", summary: "Fire exits blocked" });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/inspection/reports?created=rep-1"));
  });

  it("preselects the inspection passed from the inspection page", async () => {
    mockFetch();
    render(<CreateReportForm initialInspectionId={INSP.id} />);
    await screen.findByRole("option", { name: /cccccccc/ });
    expect((screen.getByLabelText(/^Inspection/) as HTMLSelectElement).value).toBe(INSP.id);
  });

  it("shows a readable error (not raw server text) when the create is refused", async () => {
    mockFetch(new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: inspector" }), { status: 403 }));
    render(<CreateReportForm initialInspectionId={INSP.id} />);
    await screen.findByRole("option", { name: /cccccccc/ });
    fireEvent.click(screen.getByRole("button", { name: "Create report" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/requires one of/)).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
