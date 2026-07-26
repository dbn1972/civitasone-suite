/**
 * MonitoringMap (SVC-119) tests.
 *
 * Validates that markers load from the map-markers proxy endpoint, plot onto the
 * map iframe, that filters re-query with the right params, and that selecting a
 * marker exposes a link to the underlying record.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MonitoringMap } from "./MonitoringMap";

const MARKERS = [
  { id: "m1", domain: "infrastructure", refId: "asset-9", lat: 28.61, lng: 77.23, label: "Pump Station 4", status: "alert" },
  { id: "m2", domain: "land_parcel", refId: "parcel-2", lat: 19.07, lng: 72.87, label: "Plot 12B", status: "active" },
];

function fetchReturning(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body });
}

function mapIframe(): HTMLIFrameElement {
  return screen.getByTitle("Interactive map showing locations") as HTMLIFrameElement;
}

describe("MonitoringMap (SVC-119)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchReturning({ markers: MARKERS }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads markers from the map-markers proxy endpoint", async () => {
    render(<MonitoringMap />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/api/proxy/v1/locations/map-markers");
  });

  it("plots markers onto the map iframe", async () => {
    render(<MonitoringMap />);
    await waitFor(() =>
      expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Pump Station 4"),
    );
    expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Plot 12B");
  });

  it("counts alerts in the stat tiles", async () => {
    render(<MonitoringMap />);
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Pump Station 4"));
    // One marker has status "alert".
    expect(screen.getByText("Alerts").parentElement?.textContent).toContain("1");
    expect(screen.getByText("Markers").parentElement?.textContent).toContain("2");
  });

  it("re-queries with the selected domain filter", async () => {
    render(<MonitoringMap />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Filter by domain"), {
      target: { value: "infrastructure" },
    });

    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const last = calls[calls.length - 1][0] as string;
      expect(last).toContain("domain=infrastructure");
    });
  });

  it("selecting a marker exposes a link to the underlying record", async () => {
    render(<MonitoringMap />);
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Pump Station 4"));

    // Simulate the iframe posting a marker-click for m1.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "marker-click", marker: { id: "m1", lat: 28.61, lng: 77.23, label: "Pump Station 4" } },
      }),
    );

    await waitFor(() => expect(screen.getByText("Open record →")).toBeInTheDocument());
    const link = screen.getByText("Open record →").closest("a");
    expect(link).toHaveAttribute("href", "/assets/asset-9");
  });

  it("shows an empty state when no markers match", async () => {
    vi.stubGlobal("fetch", fetchReturning({ markers: [] }));
    render(<MonitoringMap />);
    await waitFor(() => expect(screen.getByText("No markers")).toBeInTheDocument());
  });

  it("surfaces an error when the endpoint fails", async () => {
    vi.stubGlobal("fetch", fetchReturning({}, false, 502));
    render(<MonitoringMap />);
    await waitFor(() => expect(screen.getByText(/Failed to load markers/)).toBeInTheDocument());
  });
});
