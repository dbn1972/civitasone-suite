import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DataExportClient } from "./DataExportClient";
import type { DataExportRequest } from "@/app/_data/loaders";

const row = (o: Partial<DataExportRequest>): DataExportRequest => ({
  id: "ex1", type: "full", moduleFilter: null, format: "csv", status: "ready", fileSizeBytes: 2048,
  createdAt: "2026-02-01T10:00:00Z", expiresAt: "2026-02-03T10:00:00Z", downloadUrl: "/v1/admin/data-export/ex1/download", ...o,
});

describe("DataExportClient downloads (owner decision #22)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("Download fetches signed links once and lists one link per file with the 15-minute notice", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      files: [
        { entity: "feature_flags", fileName: "feature_flags.csv", rowCount: 2, sizeBytes: 100, url: "https://files.test/a?X-Amz-Expires=900" },
        { entity: "custom_domains", fileName: "custom_domains.csv", rowCount: 1, sizeBytes: 80, url: "https://files.test/b?X-Amz-Expires=900" },
      ],
    }), { status: 200 }));
    render(<DataExportClient exports={[row({})]} source="api" />);
    const trigger = screen.getByRole("link", { name: /Download full export/i });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("link", { name: "feature_flags.csv" })).toBeInTheDocument());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe("/api/proxy/v1/admin/data-export/ex1/download");
    expect(screen.getByRole("link", { name: "custom_domains.csv" }).getAttribute("href")).toContain("X-Amz-Expires=900");
    expect(screen.getByText(/expire in 15 minutes/i)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/feature_flags\.csv \(2 rows\)/);
  });

  it("an expired export shows a plain message and no links", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "EXPIRED", message: "raw" }), { status: 410 }));
    render(<DataExportClient exports={[row({})]} source="api" />);
    fireEvent.click(screen.getByRole("link", { name: /Download full export/i }));
    await waitFor(() => expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/This export has expired/i));
    expect(screen.queryByText(/expire in 15 minutes/i)).toBeNull();
  });

  it("a ready export with no stored file says so instead of linking nowhere", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ files: [] }), { status: 200 }));
    render(<DataExportClient exports={[row({})]} source="api" />);
    fireEvent.click(screen.getByRole("link", { name: /Download full export/i }));
    await waitFor(() => expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/No file was stored/i));
  });

  it("a failed export shows its reason in plain language, not the machine code", () => {
    render(<DataExportClient exports={[row({ status: "failed", failureReason: "NO_EXPORTER_FOR_MODULE", downloadUrl: null })]} source="api" />);
    expect(screen.getByRole("status").textContent).toMatch(/cannot be exported yet/i);
    expect(document.body.textContent).not.toContain("NO_EXPORTER_FOR_MODULE");
  });

  it("offers CSV and JSON only (PDF is not a supported format)", () => {
    render(<DataExportClient exports={[]} source="api" />);
    const options = Array.from(document.querySelectorAll("select option")).map((o) => o.textContent);
    expect(options.some((o) => /PDF/i.test(o ?? ""))).toBe(false);
    expect(options.some((o) => /CSV/.test(o ?? ""))).toBe(true);
    expect(options.some((o) => /JSON/.test(o ?? ""))).toBe(true);
  });
});
