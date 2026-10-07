import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
      <button type="button" onClick={() => onUploaded?.("photos/site.jpg", { fileName: "site.jpg", size: 2048, mimeType: "image/jpeg" })}>
        mock-upload
      </button>
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
});
