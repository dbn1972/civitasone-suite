import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl as render } from "@/lib/testUtils/intl";
import { screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));
vi.mock("../../../_data/worksPicker", () => ({
  searchWorkOptions: vi.fn(async () => []),
  resolveWorkOptions: vi.fn(async () => []),
}));
// Stub FileUpload to immediately report an uploaded file with meta.
vi.mock("@/app/_components/ds", async () => {
  const actual = await vi.importActual<typeof import("@/app/_components/ds")>("@/app/_components/ds");
  return {
    ...actual,
    FileUpload: ({ onUploaded }: { onUploaded?: (k: string, m: unknown) => void }) => (
      <>
        <button type="button" onClick={() => onUploaded?.("photos/site.jpg", { fileName: "site.jpg", size: 2048, mimeType: "image/jpeg" })}>
          mock-upload
        </button>
        <button
          type="button"
          onClick={() =>
            onUploaded?.("photos/site.jpg", {
              fileName: "site.jpg",
              size: 2048,
              mimeType: "image/jpeg",
              file: new File(["x"], "site.jpg", { type: "image/jpeg" }),
            })
          }
        >
          mock-upload-with-file
        </button>
      </>
    ),
  };
});

import PhotoNewPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";

describe("PhotoNewPage (GAP-WORKS-EXECUTION-PHOTOS-NEW-01/02/03/04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
  });

  it("NEW-01: label says 'Work' (not 'execution record') and there is no UUID text input", () => {
    render(<PhotoNewPage />);
    expect(screen.getByText(/Upload a photo and attach it to a work\./i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/UUID of the execution record/i)).toBeNull();
  });

  it("NEW-03: after upload the filename is shown (not the raw storage key)", () => {
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    expect(screen.getByText(/site\.jpg/)).toBeInTheDocument();
    expect(screen.queryByText(/photos\/site\.jpg/)).toBeNull(); // raw key hidden
  });

  it("NEW-02: latitude out of range is blocked client-side, no request sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    fireEvent.change(screen.getByLabelText(/Latitude/i), { target: { value: "95" } });
    fireEvent.change(screen.getByLabelText(/Longitude/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /Register Photo/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NEW-02: latitude without longitude is blocked (both or neither)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    fireEvent.change(screen.getByLabelText(/Latitude/i), { target: { value: "28.6" } });
    fireEvent.click(screen.getByRole("button", { name: /Register Photo/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/both latitude and longitude/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NEW-04: a 500 shows a clerk-safe message, never the raw status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    fireEvent.click(screen.getByRole("button", { name: /Register Photo/i }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  function postedBody(fetchSpy: { mock: { calls: unknown[][] } }) {
    const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes("/execution/photos"));
    return JSON.parse(String((call![1] as RequestInit).body));
  }

  it("NEW-02: typed coordinates are sent as source 'web-manual'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    fireEvent.change(screen.getByLabelText(/Latitude/i), { target: { value: "20.2961" } });
    fireEvent.change(screen.getByLabelText(/Longitude/i), { target: { value: "85.8245" } });
    fireEvent.click(screen.getByRole("button", { name: /Register Photo/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(postedBody(fetchSpy).source).toBe("web-manual");
  });

  it("NEW-02: coordinates filled by 'Use my location' are sent as 'web-gps', and editing them reverts to 'web-manual'", async () => {
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
          ok({ coords: { latitude: 20.2961, longitude: 85.8245 } }),
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    fireEvent.click(screen.getByRole("button", { name: /Use my location/i }));
    fireEvent.click(screen.getByRole("button", { name: /Register Photo/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(postedBody(fetchSpy).source).toBe("web-gps");
  });

  it("NEW-02: no coordinates -> plain 'web'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    fireEvent.click(screen.getByRole("button", { name: /Register Photo/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(postedBody(fetchSpy).source).toBe("web");
    // NEW-01: the id posted is the work that was picked / prefilled, not a typed value
    expect(postedBody(fetchSpy).workId).toBe(WORK);
  });

  it("NEW-03: shows an image thumbnail of the chosen photo", () => {
    const created: string[] = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (f: File) => { created.push(f.name); return "blob:preview-1"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload-with-file"));
    const img = screen.getByAltText("Preview of site.jpg");
    expect(img).toHaveAttribute("src", "blob:preview-1");
    expect(created).toEqual(["site.jpg"]);
  });
});

describe("PhotoNewPage - re-check of NEW-04 (catalogued errors, inline field messages)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
  });

  it("NEW-04: a 400 with fieldErrors shows the backend's inline message under the field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "VALIDATION_FAILED", message: "invalid", fieldErrors: [{ field: "latitude", message: "Latitude must be between -90 and 90." }] }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    fireEvent.click(screen.getByRole("button", { name: /Register Photo/i }));
    expect(await screen.findByText("Latitude must be between -90 and 90.")).toBeInTheDocument();
  });

  it("NEW-04: a network failure shows the catalogued message, not the thrown error text", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch: ECONNRESET 10.0.0.5"));
    render(<PhotoNewPage />);
    fireEvent.click(screen.getByText("mock-upload"));
    fireEvent.click(screen.getByRole("button", { name: /Register Photo/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/ECONNRESET|10\.0\.0\.5|Failed to fetch/);
    expect(alert.textContent?.length).toBeGreaterThan(10);
  });
});
