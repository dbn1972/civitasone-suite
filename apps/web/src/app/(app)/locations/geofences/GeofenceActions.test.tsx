import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { GeofenceCreateForm, GeofenceToggle } from "./GeofenceActions";
import { GeofencesTable } from "../_tables";

const ID = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0001";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.spyOn>;
beforeEach(() => { fetchMock = vi.spyOn(globalThis, "fetch"); });
afterEach(() => vi.restoreAllMocks());

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("GeofenceCreateForm (GAP-LOCATIONS-GEOFENCES-02)", () => {
  it("validates before sending: nothing is posted for an out-of-range latitude", async () => {
    render(<GeofenceCreateForm />);
    fill(/^Name/, "Head office");
    fill(/Centre latitude/, "123");
    fill(/Centre longitude/, "77.2");
    fill(/Radius/, "250");
    fireEvent.click(screen.getByRole("button", { name: "Add geofence" }));
    expect(await screen.findByText(/latitude between -90 and 90/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the typed body to the geofence route and reports the 202 as received, not done", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: ID, status: "accepted" }, 202));
    // the confirm poll: not visible yet
    fetchMock.mockResolvedValue(json({}, 404));
    render(<GeofenceCreateForm />);
    fill(/^Name/, "Head office");
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: "office" } });
    fill(/Centre latitude/, "28.6139");
    fill(/Centre longitude/, "77.209");
    fill(/Radius/, "250");
    fireEvent.click(screen.getByRole("button", { name: "Add geofence" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/proxy/v1/geofences");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: "Head office", type: "office", centerLat: 28.6139, centerLng: 77.209, radiusMeters: 250, active: true,
    });
    // never claims it is done before the record is visible
    expect(await screen.findByText(/received|updating/i)).toBeTruthy();
    expect(screen.queryByText(/^Done/)).toBeNull();
  });

  it("shows the server's field error inline and never the raw status or message", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ code: "VALIDATION_FAILED", message: "db-3.internal exploded", fieldErrors: [{ field: "radiusMeters", message: "Radius must be a positive integer" }] }, 400),
    );
    render(<GeofenceCreateForm />);
    fill(/^Name/, "Head office");
    fill(/Centre latitude/, "28.6");
    fill(/Centre longitude/, "77.2");
    fill(/Radius/, "250");
    fireEvent.click(screen.getByRole("button", { name: "Add geofence" }));
    expect(await screen.findByText("Radius must be a positive integer")).toBeTruthy();
    expect(document.body.textContent).not.toContain("db-3.internal");
    expect(document.body.textContent).not.toMatch(/\b400\b/);
  });
});

describe("GeofenceToggle", () => {
  it("deactivates an active geofence through PUT after a confirmation", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: ID, status: "accepted" }, 202));
    fetchMock.mockResolvedValue(json({ active: true }));
    render(<GeofenceToggle id={ID} name="Head office" active />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText(/will no longer be used/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Deactivate" })[1]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/proxy/v1/geofences/${ID}`);
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ active: false });
  });

  it("offers Activate for an inactive geofence", () => {
    render(<GeofenceToggle id={ID} name="Old site" active={false} />);
    expect(screen.getByRole("button", { name: "Activate" })).toBeTruthy();
  });
});

describe("GeofencesTable manage column", () => {
  const rows = [{ id: ID, name: "Head office", type: "office", shape: "circle", radius: "250 m", center: "28.6139, 77.2090", status: "active" }];
  it("shows the row action only to a manager", () => {
    const { unmount } = render(<GeofencesTable rows={rows} canManage />);
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeTruthy();
    unmount();
    render(<GeofencesTable rows={rows} />);
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
  });
});
