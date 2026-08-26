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

import { NewTicketForm } from "./NewTicketForm";

describe("NewTicketForm (citizen-facing)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
    toastSuccess.mockReset();
  });

  // Regression test for the CRITICAL bug: this form (linked from the
  // citizen-facing /helpdesk and /helpdesk/tickets hubs) posted to
  // helpdesk-service (POST /api/proxy/v1/helpdesk/tickets), which requires
  // helpdesk_user/helpdesk_admin — a plain citizen gets a hard 403 and can
  // never file a ticket. It must post to citizen-service instead, whose
  // priority enum is lowercase (unlike helpdesk-service's Capitalized one).
  it("submits to citizen-service with a lowercased priority", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "t1", status: "accepted" } }), { status: 202 }),
    );

    render(<NewTicketForm />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Water leakage near gate 3" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Pipe burst, flooding the road." } });
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/helpdesk/tickets"));
    expect(toastSuccess).toHaveBeenCalled();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/citizen/tickets");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.priority).toBe("high");
    expect(body.subject).toBe("Water leakage near gate 3");
  });

  it("parses a JSON error body into a human message instead of showing raw JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "Description is required." }), { status: 422 }),
    );

    render(<NewTicketForm />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Subject only" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Description is required.");
    expect(screen.queryByText(/VALIDATION_FAILED/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
