import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ServiceRequestActions } from "./ServiceRequestActions";

const SR_ID = "c535cf46-8472-40d9-9207-b13f54097255";

describe("ServiceRequestActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders a terminal message and no action buttons once closed", () => {
    render(<ServiceRequestActions id={SR_ID} status="closed" />);
    expect(screen.getByText(/This request is closed — no further action available/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // Regression test for the CRITICAL bug: every status transition called
  // fetch("/api/v1/crm/service-requests/.../status") instead of the only
  // working client-mutation prefix "/api/proxy/v1/crm/service-requests/...".
  // Before the fix this 404'd against the Next.js app itself every time.
  it("moves an open request to in-progress via the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="open" />);
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(screen.getByText("Move to in progress?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/service-requests/${SR_ID}/status`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "in_progress" });
  });

  it("resolves with a resolution note, notifying the citizen, via the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(screen.getByText("Resolve this request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Resolution"), { target: { value: "Certificate issued" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/service-requests/${SR_ID}/status`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "resolved",
      resolution: "Certificate issued",
    });
  });

  it("closes (danger action) via the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByText("Close this request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Closing remarks"), { target: { value: "Duplicate request" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/service-requests/${SR_ID}/status`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "closed",
      resolution: "Duplicate request",
    });
  });
});
