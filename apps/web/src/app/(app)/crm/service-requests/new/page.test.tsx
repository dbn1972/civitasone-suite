import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import NewServiceRequestPage from "./page";

describe("NewServiceRequestPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("submits the new service request to the correct proxied endpoint and navigates to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "new-sr-1" } }), { status: 201 }),
    );

    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/new-sr-1"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/service-requests");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.citizenName).toBe("Meera Devi");
    expect(body.serviceType).toBe("Birth Certificate");
  });

  it("shows the server error instead of navigating away on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Service type required" }), { status: 422 }),
    );

    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Service type required");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
