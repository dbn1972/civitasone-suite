import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { GrievanceActions } from "./GrievanceActions";

const GRIEVANCE_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";

describe("GrievanceActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders a terminal message and no action buttons once DISPOSED", () => {
    render(<GrievanceActions id={GRIEVANCE_ID} status="DISPOSED" />);
    expect(screen.getByText(/disposed — no further action available/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // Regression test for the CRITICAL bug: every grievance action called
  // fetch("/api/v1/crm/grievances/...") instead of the only working
  // client-mutation prefix, "/api/proxy/v1/crm/grievances/...". Before the
  // fix this assertion failed because the code requested the wrong (404)
  // path — the app has no Next.js route handler under /api/v1/*.
  it("forwards to the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: GRIEVANCE_ID } }), { status: 200 }),
    );

    render(<GrievanceActions id={GRIEVANCE_ID} status="REGISTERED" />);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => expect(screen.getByText("Forward this grievance?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Department / Office"), { target: { value: "Water Board" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/grievances/${GRIEVANCE_ID}/forward`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ forwardedTo: "Water Board" });
  });

  it("resolves to the correct proxied endpoint with the resolution note", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: GRIEVANCE_ID } }), { status: 200 }),
    );

    render(<GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(screen.getByText("Resolve this grievance?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Resolution"), { target: { value: "Pipe repaired" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/grievances/${GRIEVANCE_ID}/resolve`);
  });

  // The appeal-reason field is meant to be captured (the fetch handler reads
  // `reason` off ConfirmDialog), but the ActionButton omitted `requireReason`,
  // so ConfirmDialog never rendered the textarea at all — appealReason could
  // never be sent. This proves the field now actually renders and is wired.
  it("captures and sends an appeal reason for First Appeal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: GRIEVANCE_ID } }), { status: 200 }),
    );

    render(<GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" />);
    fireEvent.click(screen.getByRole("button", { name: "First Appeal" }));
    await waitFor(() => expect(screen.getByText("File a first appeal?")).toBeInTheDocument());

    expect(screen.getByLabelText("Reason for appeal")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for appeal"), { target: { value: "No response in 30 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/grievances/${GRIEVANCE_ID}/first-appeal`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ appealReason: "No response in 30 days" });
  });

  it("closes (danger action) to the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    render(<GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByText("Close this grievance?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/grievances/${GRIEVANCE_ID}/close`);
  });

  it("surfaces a server error inside the dialog instead of refreshing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Grievance already disposed" }), { status: 409 }),
    );

    render(<GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByText("Close this grievance?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByText("Grievance already disposed")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
