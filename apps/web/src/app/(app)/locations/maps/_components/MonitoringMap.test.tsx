/**
 * MonitoringMap (SVC-119) tests.
 *
 * Validates that markers load from the map-markers proxy endpoint, plot onto the
 * map iframe, that filters re-query with the right params, and that selecting a
 * marker exposes a link to the underlying record.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
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
        source: mapIframe().contentWindow,
        data: { type: "marker-click", marker: { id: "m1", lat: 28.61, lng: 77.23, label: "Pump Station 4" } },
      }),
    );

    await waitFor(() => expect(screen.getByText("Open record →")).toBeInTheDocument());
    const link = screen.getByText("Open record →").closest("a");
    // location-service's infrastructure id is not an asset-service id, so /assets/:id would 404.
    expect(link).toHaveAttribute("href", "/locations/infrastructure");
  });

  it("shows an empty state when no markers match", async () => {
    vi.stubGlobal("fetch", fetchReturning({ markers: [] }));
    render(<MonitoringMap />);
    await waitFor(() => expect(screen.getByText("No markers")).toBeInTheDocument());
  });

  it("surfaces a clerk-safe message when the endpoint fails, never the raw status (UX-016)", async () => {
    vi.stubGlobal("fetch", fetchReturning({}, false, 502));
    render(<MonitoringMap />);
    await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeInTheDocument());
    expect(screen.queryByText(/Failed to load markers/)).not.toBeInTheDocument();
  });

  // GAP-LOCATIONS-MAPS-MONITORING-03
  it("says when the data was last updated and no longer claims to be live", async () => {
    render(<MonitoringMap />);
    await waitFor(() => expect(screen.getByText(/^Updated /)).toBeInTheDocument());
    expect(screen.queryByText(/live/i)).toBeNull();
  });

  // GAP-LOCATIONS-MAPS-MONITORING-04
  it("keeps the Alerts tile real when a status filter hides the alerts", async () => {
    const fn = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ markers: url.includes("status=active") ? [MARKERS[1]] : MARKERS }),
    }));
    vi.stubGlobal("fetch", fn);
    render(<MonitoringMap />);
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Pump Station 4"));
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "active" } });
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").not.toContain("Pump Station 4"));
    expect(screen.getByText("Markers").parentElement?.textContent).toContain("1");
    expect(screen.getByText("Alerts").parentElement?.textContent).toContain("1");
  });

  // GAP-LOCATIONS-MAPS-MONITORING-05
  it("uses readable labels and 4-decimal coordinates", async () => {
    render(<MonitoringMap />);
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Pump Station 4"));
    expect(screen.getByRole("option", { name: "Land parcel" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Maintenance" })).toBeInTheDocument();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: mapIframe().contentWindow,
        data: { type: "marker-click", marker: { id: "m1", lat: 28.61, lng: 77.23, label: "Pump Station 4" } },
      }),
    );
    await waitFor(() => expect(screen.getByText("Domain: Infrastructure")).toBeInTheDocument());
    expect(screen.getByText("Status: Alert")).toBeInTheDocument();
    expect(screen.getByText("(28.6100, 77.2300)")).toBeInTheDocument();
  });

  // GAP-LOCATIONS-GEOFENCES-05 / GAP-LOCATIONS-MAPS-MONITORING-01
  it("sends geofence and parcel markers to pages that exist", async () => {
    vi.stubGlobal(
      "fetch",
      fetchReturning({
        markers: [
          { id: "g1", domain: "geofence", refId: "g1", lat: 1, lng: 2, label: "Gate", status: "active" },
          { id: "p1", domain: "parcel", refId: "p1", lat: 3, lng: 4, label: "Plot 1", status: "active" },
        ],
      }),
    );
    render(<MonitoringMap />);
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Gate"));
    window.dispatchEvent(new MessageEvent("message", { source: mapIframe().contentWindow, data: { type: "marker-click", marker: { id: "g1", lat: 1, lng: 2 } } }));
    await waitFor(() => expect(screen.getByText("Open record →").closest("a")).toHaveAttribute("href", "/locations/geofences"));
  });

  it("offers no Open record link for a parcel, which has no page", async () => {
    vi.stubGlobal(
      "fetch",
      fetchReturning({ markers: [{ id: "p1", domain: "parcel", refId: "p1", lat: 3, lng: 4, label: "Plot 1", status: "active" }] }),
    );
    render(<MonitoringMap />);
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Plot 1"));
    window.dispatchEvent(new MessageEvent("message", { source: mapIframe().contentWindow, data: { type: "marker-click", marker: { id: "p1", lat: 3, lng: 4 } } }));
    await waitFor(() => expect(screen.getByText("Plot 1")).toBeInTheDocument());
    expect(screen.queryByText("Open record →")).toBeNull();
  });

  // GAP-LOCATIONS-MAPS-MONITORING-02
  it("filters the land-parcel domain by the value the service really uses", async () => {
    render(<MonitoringMap />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Filter by domain"), { target: { value: "parcel" } });
    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[calls.length - 1]![0] as string).toContain("domain=parcel");
    });
  });

  it("says so when the feed was capped, and disables the as-of control it cannot honour", async () => {
    vi.stubGlobal("fetch", fetchReturning({ markers: MARKERS, meta: { total: 2, limit: 2, truncated: true } }));
    render(<MonitoringMap />);
    expect(await screen.findByText(/Showing the first 2 markers/)).toBeInTheDocument();
    expect(screen.getByLabelText("As of date")).toBeDisabled();
    expect(screen.getByText(/historical \(as-of\) view is not available/i)).toBeInTheDocument();
    const urls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(urls.every((u) => !u.includes("date="))).toBe(true);
  });
});
