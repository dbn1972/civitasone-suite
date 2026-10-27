import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import hi from "@/messages/hi.json";
import en from "@/messages/en.json";
import { AffidavitFiles } from "./AffidavitFiles";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const item = (o: Record<string, unknown>) => ({ id: "a1", fileName: "reply.pdf", sizeBytes: 2048, status: "filed", openable: true, uploadedAt: "2026-10-26T00:00:00Z", ...o });

describe("AffidavitFiles (GAP-LEGAL-CASES-DETAIL-01, decision #9)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows a distinct empty state when no files are attached", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    render(<AffidavitFiles caseId="c1" />);
    expect(await screen.findByText("No affidavit files are attached to this case.")).toBeInTheDocument();
  });

  it("shows a retryable error state (not the empty state) when the list fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "X" }, 503));
    render(<AffidavitFiles caseId="c1" />);
    expect(await screen.findByText("The affidavit files could not be loaded. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("No affidavit files are attached to this case.")).not.toBeInTheDocument();
  });

  it("lists files with their scan status and only offers Open on a ready file", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [item({}), item({ id: "a2", fileName: "bad.pdf", status: "quarantined", openable: false })] }));
    render(<AffidavitFiles caseId="c1" />);
    expect(await screen.findByText("reply.pdf")).toBeInTheDocument();
    expect(screen.getByText("Blocked (failed virus scan)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(1);
  });

  it("opens a ready file through the audited download endpoint", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    fetchMock.mockResolvedValueOnce(json({ items: [item({})] }));
    render(<AffidavitFiles caseId="c1" />);
    const btn = await screen.findByRole("button", { name: "Open" });
    fetchMock.mockResolvedValueOnce(json({ downloadUrl: "https://store.example/get?sig=1", expiresAt: "x", fileName: "reply.pdf" }));
    fireEvent.click(btn);
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://store.example/get?sig=1", "_blank", "noopener,noreferrer"));
    expect(fetchMock.mock.calls[1]![0]).toContain("/affidavits/a1/download");
  });

  it("rejects an unsupported file client-side and uploads a valid one: start, PUT to the store, complete", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    render(<AffidavitFiles caseId="c1" />);
    const input = (await screen.findByLabelText(/Choose a file/)) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(["x"], "evil.exe", { type: "application/x-msdownload" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("This file type is not accepted. Use PDF, JPG, PNG or TIFF.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock
      .mockResolvedValueOnce(json({ id: "a9", upload: { url: "https://store.example/put", method: "PUT", headers: { "Content-Type": "application/pdf" } } }, 202))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(json({ id: "a9" }, 202))
      .mockResolvedValueOnce(json({ items: [item({ id: "a9", status: "processing", openable: false })] }));
    fireEvent.change(input, { target: { files: [new File(["%PDF"], "reply.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[2]![0]).toBe("https://store.example/put");
    expect((fetchMock.mock.calls[2]![1] as RequestInit).method).toBe("PUT");
    expect(fetchMock.mock.calls[3]![0]).toContain("/affidavits/a9/complete");
    expect(await screen.findByText("Being checked")).toBeInTheDocument();
  });

  it("has Hindi copy for every English key", () => {
    const flat = (o: Record<string, unknown>, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === "object" && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]);
    const enKeys = flat((en as Record<string, Record<string, unknown>>).legalAffidavits!).sort();
    const hiKeys = flat((hi as Record<string, Record<string, unknown>>).legalAffidavits!).sort();
    expect(hiKeys).toEqual(enKeys);
  });
});
