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

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/helpdesk/internal"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/helpdesk/tickets");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.priority).toBe("Low");
  });
});
