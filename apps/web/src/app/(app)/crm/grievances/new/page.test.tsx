import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import NewGrievancePage from "./page";

describe("NewGrievancePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  // Regression test for the CRITICAL bug: the form posted to
  // fetch("/api/v1/crm/grievances") instead of the only working
  // client-mutation prefix "/api/proxy/v1/crm/grievances" — a citizen could
  // never actually file a grievance, the request 404'd against the Next.js
  // app itself every time.
  it("submits the new grievance to the correct proxied endpoint and navigates to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "new-grievance-1" } }), { status: 201 }),
    );

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water for 3 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/new-grievance-1"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/grievances");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.citizenName).toBe("Ravi Kumar");
    expect(body.category).toBe("Water Supply");
  });

  it("shows the server error instead of navigating away on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid category" }), { status: 422 }),
    );

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water for 3 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid category");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
