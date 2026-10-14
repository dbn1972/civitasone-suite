/**
 * MapViewer (SVC-112) tests.
 *
 * Validates that map layers load from the proxy, render into the layer panel and
 * onto the map iframe, toggle visibility, and that admin-only controls are gated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
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
    window.localStorage.clear();
    vi.stubGlobal("fetch", mockFetchOnce({ data: LAYERS }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads layers from the map-layers proxy endpoint", async () => {
    render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    // UX-fetch-cancellation: the mount-time fetch is now threaded an
    // AbortSignal (cleaned up on unmount) -- see load()'s AbortController.
    expect(fetch).toHaveBeenCalledWith("/api/proxy/v1/locations/map-layers", { signal: expect.any(AbortSignal) });
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

  it("surfaces a clerk-safe message when the endpoint fails, never the raw status (UX-016)", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({}, false, 500));
    render(<MapViewer />);
    await waitFor(() =>
      expect(screen.getByText(/couldn't load/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Failed to load map layers/)).not.toBeInTheDocument();
  });
});

describe("MapViewer delete confirmation (GAP-LOCATIONS-MAPS-01)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", mockFetchOnce({ data: LAYERS }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const deleteCalls = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");

  it("does not delete on click: it opens a dialog, and Cancel leaves the layer listed", async () => {
    render(<MapViewer canManage />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Delete Ward Boundaries"));
    expect(await screen.findByText("Delete this map layer?")).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByText("Ward Boundaries")).toBeInTheDocument();
  });

  it("keeps Confirm disabled until a reason is entered, then sends the reason with the DELETE", async () => {
    render(<MapViewer canManage />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Delete Ward Boundaries"));
    const confirm = await screen.findByRole("button", { name: "Delete layer" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for deleting"), { target: { value: "Superseded basemap" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0]![0]).toBe("/api/proxy/v1/locations/map-layers/l1?reason=Superseded%20basemap");
  });

  it("shows catalogued copy, not the raw response, when the delete fails", async () => {
    const fn = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response("ERROR relation map_layers db-7.internal", { status: 500 })
        : { ok: true, status: 200, json: async () => ({ data: LAYERS }) },
    );
    vi.stubGlobal("fetch", fn);
    render(<MapViewer canManage />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Delete Ward Boundaries"));
    fireEvent.change(await screen.findByLabelText("Reason for deleting"), { target: { value: "Wrong layer" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete layer" }));
    await waitFor(() => expect(fn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(document.body.textContent).toMatch(/couldn't/i));
    expect(document.body.textContent).not.toContain("db-7.internal");
  });
});

describe("MapViewer layer visibility persistence (GAP-LOCATIONS-MAPS-04)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", mockFetchOnce({ data: LAYERS }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("restores a hidden layer after the viewer remounts", async () => {
    const first = render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Toggle Ward Boundaries"));
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").not.toContain("wards.geojson"));
    first.unmount();

    render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    expect(screen.getByLabelText("Toggle Ward Boundaries")).not.toBeChecked();
    expect(mapIframe().getAttribute("srcdoc") ?? "").not.toContain("wards.geojson");
  });

  it("keeps a hidden layer hidden when the list is reloaded after an add", async () => {
    const fn = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: LAYERS }) });
    vi.stubGlobal("fetch", fn);
    render(<MapViewer canManage />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Toggle Ward Boundaries"));
    fireEvent.click(screen.getByRole("button", { name: /Add layer/ }));
    fireEvent.change(screen.getByLabelText("Layer name"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Layer source URL"), { target: { value: "https://gis.example/new/{z}/{x}/{y}.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Save layer" }));
    await waitFor(() => expect(fn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    await waitFor(() => expect(fn.mock.calls.filter((c) => !(c[1] as RequestInit | undefined)?.method).length).toBeGreaterThanOrEqual(2));
    expect(screen.getByLabelText("Toggle Ward Boundaries")).not.toBeChecked();
  });

  it("still works when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Toggle Ward Boundaries"));
    await waitFor(() => expect(mapIframe().getAttribute("srcdoc") ?? "").not.toContain("wards.geojson"));
  });
});

describe("MapViewer source labels and https guard (GAP-LOCATIONS-MAPS-05 / MAPS-03)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", mockFetchOnce({ data: LAYERS }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows readable source labels, not the raw enum", async () => {
    render(<MapViewer />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    expect(screen.getByText("GeoJSON")).toBeInTheDocument();
    expect(screen.getByText("Tile (XYZ)")).toBeInTheDocument();
  });

  it("refuses a non-https source URL before calling the service", async () => {
    render(<MapViewer canManage />);
    await waitFor(() => expect(screen.getByText("Ward Boundaries")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add layer/ }));
    fireEvent.change(screen.getByLabelText("Layer name"), { target: { value: "Bad" } });
    fireEvent.change(screen.getByLabelText("Layer source URL"), { target: { value: "http://evil.example/{z}/{x}/{y}.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Save layer" }));
    expect(await screen.findByText("The source URL must start with https://.")).toBeInTheDocument();
    const posts = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(0);
  });
});

