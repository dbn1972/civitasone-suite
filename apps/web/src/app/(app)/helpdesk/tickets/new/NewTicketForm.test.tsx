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

  it("shows a clerk-safe message instead of the raw JSON error body (UX-016)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "Description is required." }), { status: 422 }),
    );

    render(<NewTicketForm />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Subject only" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(screen.queryByText(/VALIDATION_FAILED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Description is required\./)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

/**
 * GAP-HELPDESK-TICKETS-NEW-01/02/03/04/05 tests (batch 2, agent 2).
 * Appended to avoid conflict with existing tests above.
 */
describe("NewTicketForm (GAP-HELPDESK-TICKETS-NEW batch 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
    toastSuccess.mockReset();
  });

  it("NEW-01: sends channel field in POST body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "t1" } }), { status: 202 }),
    );

    render(<NewTicketForm />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Phone complaint" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Citizen called about water." } });
    fireEvent.change(screen.getByLabelText(/channel/i), { target: { value: "phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.channel).toBe("phone");
  });

  it("NEW-02: 201 with ticketNo shows toast + navigates to detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "t2", ticketNo: "TKT-102" } }), { status: 201 }),
    );

    render(<NewTicketForm />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Test description" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/helpdesk/tickets/t2"));
    expect(toastSuccess).toHaveBeenCalledWith("Ticket TKT-102 submitted.");
  });

  it("NEW-02: empty body still succeeds without crash (fallback to list)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 202 }),
    );

    render(<NewTicketForm />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Body" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/helpdesk/tickets"));
    expect(toastSuccess).toHaveBeenCalledWith("Ticket submitted successfully.");
  });

  it("NEW-03: no #fff or #b91c1c or #047857 hex in rendered output (uses CSS tokens)", () => {
    const { container } = render(<NewTicketForm />);
    const html = container.innerHTML;
    expect(html).not.toContain("#fff");
    expect(html).not.toContain("#b91c1c");
    expect(html).not.toContain("#047857");
  });

  it("NEW-04: empty submit sets aria-invalid on subject and shows per-field error", () => {
    render(<NewTicketForm />);
    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    const subjectInput = screen.getByLabelText(/subject/i);
    expect(subjectInput).toHaveAttribute("aria-invalid", "true");
    // Per-field error is present (may appear in both the field and the summary area).
    const errors = screen.getAllByText("Subject is required.");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    // Subject input is linked to its error via aria-describedby
    expect(subjectInput).toHaveAttribute("aria-describedby", "subject-error");
  });

  it("NEW-04: DPDP hint present on description", () => {
    render(<NewTicketForm />);
    expect(screen.getByText(/do not enter aadhaar/i)).toBeInTheDocument();
  });

  it("NEW-05: priority select shows SLA note", () => {
    render(<NewTicketForm />);
    expect(screen.getByText(/SLA target: within 24 hours\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: "Critical" } });
    expect(screen.getByText(/use only for urgent/i)).toBeInTheDocument();
  });
});
