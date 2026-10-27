/**
 * MonitoringMap (SVC-119) tests.
 *
 * Validates that markers load from the map-markers proxy endpoint, plot onto the
 * map iframe, that filters re-query with the right params, and that selecting a
 * marker exposes a link to the underlying record.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
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
  it("sends geofence markers to the geofence register", async () => {
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

  it("opens a parcel's own page from its Open record link (GAP-LOCATIONS-MAPS-MONITORING-01)", async () => {
    vi.stubGlobal(
      "fetch",
      fetchReturning({ markers: [{ id: "m-p1", domain: "parcel", refId: "7c1f0a52-4c2e-4b53-9d1a-0c6b1b6f1001", lat: 3, lng: 4, label: "Plot 1", status: "active" }] }),
    );
    render(<MonitoringMap />);
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Plot 1"));
    window.dispatchEvent(new MessageEvent("message", { source: mapIframe().contentWindow, data: { type: "marker-click", marker: { id: "m-p1", lat: 3, lng: 4 } } }));
    await waitFor(() => expect(screen.getByText("Open record →").closest("a")).toHaveAttribute("href", "/locations/parcels/7c1f0a52-4c2e-4b53-9d1a-0c6b1b6f1001"));
  });

  it("offers no Open record link for a marker with no record to open (e.g. a bare geo-point)", async () => {
    vi.stubGlobal(
      "fetch",
      fetchReturning({ markers: [{ id: "gp1", domain: "vehicle", refId: "v-9", lat: 3, lng: 4, label: "Truck 9", status: "active" }] }),
    );
    render(<MonitoringMap />);
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("Truck 9"));
    window.dispatchEvent(new MessageEvent("message", { source: mapIframe().contentWindow, data: { type: "marker-click", marker: { id: "gp1", lat: 3, lng: 4 } } }));
    await waitFor(() => expect(screen.getByText("Truck 9")).toBeInTheDocument());
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

  it("says so when the feed was capped", async () => {
    vi.stubGlobal("fetch", fetchReturning({ markers: MARKERS, meta: { total: 2, limit: 2, truncated: true } }));
    render(<MonitoringMap />);
    expect(await screen.findByText(/Showing the first 2 markers/)).toBeInTheDocument();
  });

  // GAP-LOCATIONS-MAPS-MONITORING-02
  describe("as-of date", () => {
    const lastUrl = () => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      return calls[calls.length - 1]![0] as string;
    };

    it("is enabled, sends no date until one is chosen, and cannot be set in the future", async () => {
      render(<MonitoringMap />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(lastUrl()).not.toContain("date=");
      const input = screen.getByLabelText("As of date") as HTMLInputElement;
      expect(input).not.toBeDisabled();
      expect(input.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("re-queries with date=<day>, says what the view means, and clears back to today", async () => {
      render(<MonitoringMap />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByLabelText("As of date"), { target: { value: "2020-01-01" } });
      await waitFor(() => expect(lastUrl()).toContain("date=2020-01-01"));
      expect(screen.getByText(/Showing records that existed on/)).toBeInTheDocument();
      expect(screen.getByText(/status and position are as of today/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show today" }));
      await waitFor(() => expect(lastUrl()).not.toContain("date="));
      expect(screen.queryByText(/Showing records that existed on/)).toBeNull();
    });

    it("keeps the date when the status tiles are recomputed under a status filter", async () => {
      render(<MonitoringMap />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByLabelText("As of date"), { target: { value: "2020-01-01" } });
      fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "active" } });
      await waitFor(() => {
        const urls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
        expect(urls.some((u) => u.includes("status=active") && u.includes("date=2020-01-01"))).toBe(true);
        expect(urls.some((u) => !u.includes("status=") && u.includes("date=2020-01-01"))).toBe(true);
      });
    });
  });

  // GAP-LOCATIONS-MAPS-MONITORING-02
  describe("only this map area", () => {
    const sendView = (view: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { source: mapIframe().contentWindow, data: { type: "map-view", ...(view as object) } }));
      });
    const lastUrl = () => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      return calls[calls.length - 1]![0] as string;
    };

    it("is disabled until the map has reported what it shows", async () => {
      render(<MonitoringMap />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("button", { name: "Only this map area" })).toBeDisabled();
    });

    it("sends the visible bounds as bbox (clamped to valid coordinates), then lifts the restriction", async () => {
      render(<MonitoringMap />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      sendView({ bbox: [-200, 18.5, 79.25, 95], center: { lat: 28.6, lng: 77.2 }, zoom: 7 });
      fireEvent.click(await screen.findByRole("button", { name: "Only this map area" }));
      await waitFor(() => expect(decodeURIComponent(lastUrl())).toContain("bbox=-180.00000,18.50000,79.25000,90.00000"));
      expect(screen.getByText(/only the markers inside the map area/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show everywhere" }));
      await waitFor(() => expect(lastUrl()).not.toContain("bbox="));
    });

    it("ignores a malformed view message", async () => {
      render(<MonitoringMap />);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      sendView({ bbox: ["a", 1, 2, 3], center: { lat: 1, lng: 2 }, zoom: 3 });
      expect(screen.getByRole("button", { name: "Only this map area" })).toBeDisabled();
    });
  });

  // CLOS-S2-04: an aborted (superseded) load must not clear the loading flag that
  // the newer in-flight load set.
  it("CLOS-S2-04: stays in the loading state while the superseding request is still in flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      ),
    );
    render(<MonitoringMap />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Loading markers…")).toBeInTheDocument();

    // Changing the filter aborts request #1 and starts request #2 (never resolves).
    fireEvent.change(screen.getByLabelText("Filter by domain"), { target: { value: "infrastructure" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    // Let request #1's AbortError rejection and its finally block run.
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.getByText("Loading markers…")).toBeInTheDocument();
    expect(screen.queryByText("No markers")).not.toBeInTheDocument();
  });
});
