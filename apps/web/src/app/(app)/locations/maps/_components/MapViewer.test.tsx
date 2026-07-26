/**
 * MapViewer (SVC-112) tests.
 *
 * Validates that map layers load from the proxy, render into the layer panel and
 * onto the map iframe, toggle visibility, and that admin-only controls are gated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MapViewer } from "./MapViewer";

const LAYERS = [
  { id: "l1", name: "Ward Boundaries", sourceType: "geojson", url: "https://gis.example/wards.geojson", zIndex: 20, visible: true },
  { id: "l2", name: "Satellite Base", sourceType: "tile", url: "https://gis.example/{z}/{x}/{y}.png", zIndex: 5, visible: true },
];

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

function mapIframe(): HTMLIFrameElement {
  return screen.getByTitle("Interactive map showing locations") as HTMLIFrameElement;
}

describe("MapViewer (SVC-112)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchOnce({ data: LAYERS }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads layers from the map-layers proxy endpoint", async () => {
    render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/proxy/v1/locations/map-layers");
    expect(screen.getByText("Satellite Base")).toBeInTheDocument();
  });

  it("renders visible layers onto the map iframe", async () => {
    render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    const srcdoc = mapIframe().getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("https://gis.example/wards.geojson");
  });

  it("toggles a layer off so it is removed from the map", async () => {
    render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    expect(mapIframe().getAttribute("srcdoc") ?? "").toContain("wards.geojson");

    const toggle = screen.getByLabelText("Toggle Ward Boundaries");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mapIframe().getAttribute("srcdoc") ?? "").not.toContain("wards.geojson"),
    );
  });

  it("hides admin controls for non-managers", async () => {
    render(<MapViewer canManage={false} />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Add layer/ })).toBeNull();
    expect(screen.queryByLabelText("Delete Ward Boundaries")).toBeNull();
  });

  it("shows admin create + delete controls for managers", async () => {
    render(<MapViewer canManage />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Add layer/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Delete Ward Boundaries")).toBeInTheDocument();
  });

  it("shows an empty state when no layers exist", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ data: [] }));
    render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("No layers yet")).toBeInTheDocument());
  });

  it("surfaces an error when the endpoint fails", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({}, false, 500));
    render(<MapViewer />);
    await waitFor(() =>
      expect(screen.getByText(/Failed to load map layers/)).toBeInTheDocument(),
    );
  });
});
