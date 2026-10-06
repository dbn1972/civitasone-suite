import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess } }),
}));

import { NewInternalTicketForm } from "./NewInternalTicketForm";

// This form preserves the pre-fix behaviour of the shared ticket form (it
// still correctly targets helpdesk-service with a Capitalized priority) —
// splitting citizen vs. staff ticket intake into two routes must not
// regress the internal ops queue's already-working ticket creation.
describe("NewInternalTicketForm (staff-facing)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
    toastSuccess.mockReset();
  });

  it("submits to helpdesk-service with a Capitalized priority", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "t1" } }), { status: 202 }),
    );

    render(<NewInternalTicketForm />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Printer down on 3rd floor" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Needs a toner replacement." } });
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: "Low" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/helpdesk/internal/t1"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/helpdesk/tickets");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.priority).toBe("Low");
  });

  // GAP-HELPDESK-INTERNAL-NEW-04: the success toast should carry a ticket
  // reference derived from the response, and navigate to the detail page.
  it("includes a ticket reference in the toast and navigates to the detail page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "aaaabbbb-cccc-dddd-eeee-ffff00001111" } }), { status: 201 }),
    );
    render(<NewInternalTicketForm />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Door lock jammed" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Main entrance." } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toContain("INT-AAAABBBB");
    expect(pushMock).toHaveBeenCalledWith("/helpdesk/internal/aaaabbbb-cccc-dddd-eeee-ffff00001111");
  });

  // GAP-HELPDESK-INTERNAL-NEW-03: no hard-coded light-theme colours in the form.
  it("renders no hard-coded #fff / #b91c1c / #047857 colours", () => {
    const { container } = render(<NewInternalTicketForm />);
    const html = container.innerHTML;
    expect(html).not.toContain("#fff");
    expect(html).not.toContain("#b91c1c");
    expect(html).not.toContain("#047857");
  });
});
