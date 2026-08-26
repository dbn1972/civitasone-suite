import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { DocumentsPanel } from "./DocumentsPanel";
import * as dm from "@/lib/crm/documents";

vi.mock("@/lib/crm/documents", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/documents")>();
  return {
    ...actual,
    getDocuments: vi.fn(),
    getDocumentTypes: vi.fn(),
    presignUpload: vi.fn(),
    uploadToStorage: vi.fn(),
    confirmDocument: vi.fn(),
    getDownloadUrl: vi.fn(),
    deleteDocument: vi.fn(),
    verifyDocument: vi.fn(),
  };
});

const doc = (over: Partial<dm.Document> = {}): dm.Document =>
  dm.normaliseDocument({
    id: "d1", subjectType: "contact", subjectId: "c1", docType: "pan", title: "PAN card",
    filename: "pan.pdf", version: 1, isCurrent: true, scanStatus: "clean",
    verificationStatus: "unverified", storageProvider: "s3", sizeBytes: 2048,
    createdAt: "2026-05-01T09:00:00Z", ...over,
  }) as dm.Document;

function setFile(name = "new.pdf", type = "application/pdf") {
  const input = screen.getByLabelText(/^File$/i) as HTMLInputElement;
  const file = new File(["bytes"], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  vi.mocked(dm.getDocuments).mockReset();
  vi.mocked(dm.getDocumentTypes).mockReset();
  vi.mocked(dm.presignUpload).mockReset();
  vi.mocked(dm.uploadToStorage).mockReset();
  vi.mocked(dm.confirmDocument).mockReset();
  vi.mocked(dm.getDownloadUrl).mockReset();
  vi.mocked(dm.deleteDocument).mockReset();
  vi.mocked(dm.verifyDocument).mockReset();
  vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "api" });
});

describe("DocumentsPanel (DM-001/002/003)", () => {
  it("shows the saved-info badge on a failed load and no fabricated list", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [], source: "error" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/documents unavailable/i)).toBeInTheDocument();
  });

  it("uploads via presign -> PUT -> confirm then reloads (happy path)", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(dm.presignUpload).mockResolvedValue({ uploadUrl: "https://s3/put", storageKey: "k/1" });
    vi.mocked(dm.uploadToStorage).mockResolvedValue();
    vi.mocked(dm.confirmDocument).mockResolvedValue(doc());
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeInTheDocument());

    setFile();
    fireEvent.click(screen.getByRole("button", { name: /upload document/i }));

    await waitFor(() => expect(dm.confirmDocument).toHaveBeenCalled());
    expect(dm.presignUpload).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: "contact", subjectId: "c1", filename: "new.pdf", mimeType: "application/pdf" }),
    );
    expect(dm.uploadToStorage).toHaveBeenCalledWith("https://s3/put", expect.any(File), "application/pdf");
    expect(vi.mocked(dm.confirmDocument).mock.calls[0][0]).toMatchObject({ storageKey: "k/1", filename: "new.pdf", sizeBytes: 5 });
    expect(await screen.findByText(/will be scanned before it can be downloaded/i)).toBeInTheDocument();
    // reloaded: getDocuments called twice (initial + after upload)
    expect(vi.mocked(dm.getDocuments)).toHaveBeenCalledTimes(2);
  });

  it("surfaces a presign/storage failure honestly (no confirm)", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(dm.presignUpload).mockRejectedValue(new Error("PRESIGN_INCOMPLETE: nope"));
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeInTheDocument());
    setFile();
    fireEvent.click(screen.getByRole("button", { name: /upload document/i }));
    expect(await screen.findByText(/PRESIGN_INCOMPLETE/i)).toBeInTheDocument();
    expect(dm.confirmDocument).not.toHaveBeenCalled();
  });

  it("blocks upload with no file chosen", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [], source: "api" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /upload document/i }));
    expect(await screen.findByText(/choose a file to upload/i)).toBeInTheDocument();
    expect(dm.presignUpload).not.toHaveBeenCalled();
  });

  it("renders a clean document with download + storage-provider indicator", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc()], source: "api" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText("PAN card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Download$/i })).toBeInTheDocument();
    expect(screen.getByText(/secure storage/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scan status: clean/i)).toBeInTheDocument();
  });

  it("labels an external doc as stored in DMS", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc({ storageProvider: "knowledge_dms" })], source: "api" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText(/stored in dms/i)).toBeInTheDocument();
  });

  it("NEVER offers a download for an infected file and warns", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc({ scanStatus: "infected" })], source: "api" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText(/flagged by the malware scan/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/scan status: infected/i)).toBeInTheDocument();
  });

  it("opens the presigned URL on download", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc()], source: "api" });
    vi.mocked(dm.getDownloadUrl).mockResolvedValue("https://s3/get?sig=1");
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Download$/i }));
    await waitFor(() => expect(dm.getDownloadUrl).toHaveBeenCalledWith("d1"));
    expect(openSpy).toHaveBeenCalledWith("https://s3/get?sig=1", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("shows version history when a chain has multiple versions", async () => {
    const v1 = doc({ id: "v1", version: 1, isCurrent: false, createdAt: "2026-01-01T00:00:00Z" });
    const v2 = doc({ id: "v2", version: 2, isCurrent: true, supersedesId: "v1", createdAt: "2026-02-01T00:00:00Z", filename: "pan-v2.pdf" });
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [v1, v2], source: "api" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    const toggle = await screen.findByRole("button", { name: /show version history/i });
    fireEvent.click(toggle);
    const history = await screen.findByRole("list", { name: /version history for PAN card/i });
    expect(within(history).getByText(/pan\.pdf/)).toBeInTheDocument();
  });

  it("deletes a document through the confirm dialog", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc()], source: "api" });
    vi.mocked(dm.deleteDocument).mockResolvedValue();
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(dm.deleteDocument).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText(/document deleted/i)).toBeInTheDocument();
  });

  it("verifies a document when canVerify (DM-002)", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc()], source: "api" });
    vi.mocked(dm.verifyDocument).mockResolvedValue();
    render(<DocumentsPanel subjectType="contact" subjectId="c1" canVerify />);
    fireEvent.click(await screen.findByRole("button", { name: /^Verify$/i }));
    await waitFor(() => expect(dm.verifyDocument).toHaveBeenCalledWith("d1", "verified", undefined));
    expect(await screen.findByText(/marked verified/i)).toBeInTheDocument();
  });

  it("rejects a document with a required reason via the confirm dialog", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc()], source: "api" });
    vi.mocked(dm.verifyDocument).mockResolvedValue();
    render(<DocumentsPanel subjectType="contact" subjectId="c1" canVerify />);
    fireEvent.click(await screen.findByRole("button", { name: /^Reject$/i }));
    const dialog = await screen.findByRole("alertdialog");
    // confirm disabled until reason entered
    const confirmBtn = within(dialog).getByRole("button", { name: /reject document/i });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason for rejection/i), { target: { value: "blurry" } });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(dm.verifyDocument).toHaveBeenCalledWith("d1", "rejected", "blurry"));
  });

  it("shows NO working download for a pending-scan file, only a scan-in-progress note", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc({ scanStatus: "pending" })], source: "api" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    await screen.findByText("PAN card");
    expect(screen.queryByRole("button", { name: /^Download$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/scan in progress/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scan status: scan pending/i)).toBeInTheDocument();
  });

  it("shows NO download for a scan-error file", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc({ scanStatus: "error" })], source: "api" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    await screen.findByText("PAN card");
    expect(screen.queryByRole("button", { name: /^Download$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/scan could not complete/i)).toBeInTheDocument();
  });

  it("flags when the document-type list failed to load (not empty-by-config)", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "error" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText(/document-type list could not be loaded/i)).toBeInTheDocument();
  });

  it("does not show verify/reject when canVerify is false", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc()], source: "api" });
    render(<DocumentsPanel subjectType="contact" subjectId="c1" />);
    await screen.findByText("PAN card");
    expect(screen.queryByRole("button", { name: /^Verify$/i })).not.toBeInTheDocument();
  });
});
