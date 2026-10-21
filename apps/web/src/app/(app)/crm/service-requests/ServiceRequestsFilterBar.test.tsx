import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

const replaceMock = vi.fn();
let currentQuery = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/crm/service-requests",
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

import { ServiceRequestsFilterBar } from "./ServiceRequestsFilterBar";

const ME = "11111111-2222-4333-8444-555566667777";

function renderBar(props: Partial<Parameters<typeof ServiceRequestsFilterBar>[0]> = {}) {
  return render(<ServiceRequestsFilterBar serviceTypes={["Birth Certificate"]} {...props} />);
}

beforeEach(() => {
  replaceMock.mockReset();
  currentQuery = "";
});

// GAP-CRM-SERVICE-REQUESTS-03: the desk filters write the URL (server-side filtering), and every
// change returns to page 1.
describe("ServiceRequestsFilterBar — overdue / assigned-to-me / sort", () => {
  it("'Overdue only' sets overdue=true and clears it again, dropping the page param", () => {
    currentQuery = "page=3&status=open";
    renderBar();
    fireEvent.click(screen.getByLabelText("Overdue only"));
    expect(replaceMock).toHaveBeenLastCalledWith("/crm/service-requests?status=open&overdue=true");

    currentQuery = "overdue=true";
    replaceMock.mockReset();
    renderBar({ overdue: true });
    const boxes = screen.getAllByLabelText("Overdue only");
    fireEvent.click(boxes[boxes.length - 1]!);
    expect(replaceMock).toHaveBeenLastCalledWith("/crm/service-requests");
  });

  it("'Assigned to me' sets assignedTo to the viewer's own id, and is checked only when it matches", () => {
    renderBar({ currentUserId: ME });
    const box = screen.getByLabelText("Assigned to me") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(replaceMock).toHaveBeenLastCalledWith(`/crm/service-requests?assignedTo=${ME}`);
  });

  it("'Assigned to me' is checked when the active owner filter is the viewer", () => {
    renderBar({ currentUserId: ME, assignedTo: ME });
    expect((screen.getByLabelText("Assigned to me") as HTMLInputElement).checked).toBe(true);
  });

  it("'Assigned to me' is checked off when someone else's id is in the URL", () => {
    renderBar({ currentUserId: ME, assignedTo: "99999999-2222-4333-8444-555566667777" });
    expect((screen.getByLabelText("Assigned to me") as HTMLInputElement).checked).toBe(false);
  });

  it("does not offer 'Assigned to me' when the viewer's id is unknown", () => {
    renderBar({ currentUserId: null });
    expect(screen.queryByLabelText("Assigned to me")).not.toBeInTheDocument();
  });

  it("sorts by due date via sort=dueAt and back to the default", () => {
    renderBar();
    fireEvent.change(screen.getByLabelText("Sort requests"), { target: { value: "dueAt" } });
    expect(replaceMock).toHaveBeenLastCalledWith("/crm/service-requests?sort=dueAt");

    currentQuery = "sort=dueAt";
    replaceMock.mockReset();
    renderBar({ sort: "dueAt" });
    const selects = screen.getAllByLabelText("Sort requests");
    fireEvent.change(selects[selects.length - 1]!, { target: { value: "" } });
    expect(replaceMock).toHaveBeenLastCalledWith("/crm/service-requests");
  });
});
