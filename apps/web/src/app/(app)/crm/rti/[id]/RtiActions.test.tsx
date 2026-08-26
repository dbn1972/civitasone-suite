import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RtiActions } from "./RtiActions";

const RTI_ID = "9e10b6c1-2222-4444-8888-000000000001";

describe("RtiActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders a read-only message once DISPOSED, with no action buttons", () => {
    render(<RtiActions id={RTI_ID} status="DISPOSED" />);
    expect(screen.getByText(/no further action available here/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows Forward and Respond while RECEIVED, but not First Appeal", () => {
    render(<RtiActions id={RTI_ID} status="RECEIVED" />);
    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Respond" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "First Appeal" })).not.toBeInTheDocument();
  });

  it("shows only First Appeal once RESPONDED", () => {
    render(<RtiActions id={RTI_ID} status="RESPONDED" />);
    expect(screen.getByRole("button", { name: "First Appeal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forward" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Respond" })).not.toBeInTheDocument();
  });

  it("forwards to another department via the proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );

    render(<RtiActions id={RTI_ID} status="RECEIVED" />);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("Forward this RTI request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Department / Office"), { target: { value: "Dept of Revenue" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/forward`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ departmentRef: "Dept of Revenue" });
  });

  it("records a response within the statutory deadline via the proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );

    render(<RtiActions id={RTI_ID} status="TRANSFERRED" />);
    fireEvent.click(screen.getByRole("button", { name: "Respond" }));
    await waitFor(() => expect(screen.getByText("Record the response to this RTI request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Response text"), { target: { value: "Information enclosed as annexure." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/respond`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      responseText: "Information enclosed as annexure.",
    });
  });

  it("raises a first appeal via the proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );

    render(<RtiActions id={RTI_ID} status="RESPONDED" />);
    fireEvent.click(screen.getByRole("button", { name: "First Appeal" }));
    await waitFor(() => expect(screen.getByText("Raise a first appeal?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/first-appeal`);
  });
});
