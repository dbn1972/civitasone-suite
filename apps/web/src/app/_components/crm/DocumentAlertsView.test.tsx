import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DocumentAlertsView } from "./DocumentAlertsView";
import * as dm from "@/lib/crm/documents";

vi.mock("@/lib/crm/documents", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/documents")>();
  return { ...actual, getDocuments: vi.fn(), getDocumentTypes: vi.fn() };
});

const doc = (over: Partial<dm.Document> = {}): dm.Document =>
  dm.normaliseDocument({
    id: "d1", subjectType: "contact", subjectId: "c1", docType: "gst", title: "GST", filename: "g.pdf",
    version: 1, isCurrent: true, scanStatus: "clean", verificationStatus: "unverified",
    storageProvider: "s3", ...over,
  }) as dm.Document;

const type = (over: Partial<dm.DocumentType> = {}): dm.DocumentType => ({
  code: "pan", name: "PAN card", appliesTo: ["contact"], mandatory: true,
  expiryRequired: false, verificationRequired: false, enabled: true, ...over,
});

beforeEach(() => {
  vi.mocked(dm.getDocuments).mockReset();
  vi.mocked(dm.getDocumentTypes).mockReset();
});

describe("DocumentAlertsView (DM-002)", () => {
  it("shows the saved-info badge when either feed fails", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [], source: "error" });
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [], source: "api" });
    render(<DocumentAlertsView subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/showing saved information/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/document requirements unavailable/i)).toBeInTheDocument();
  });

  it("reports all-clear when nothing is missing or expiring", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [doc({ docType: "pan" })], source: "api" });
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type()], source: "api" });
    render(<DocumentAlertsView subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText(/all required documents are present/i)).toBeInTheDocument();
  });

  it("flags a missing mandatory document", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({ data: [type()], source: "api" });
    render(<DocumentAlertsView subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText(/^Missing$/i)).toBeInTheDocument();
    expect(screen.getByText("PAN card")).toBeInTheDocument();
  });

  it("flags an expired document", async () => {
    vi.mocked(dm.getDocuments).mockResolvedValue({
      data: [doc({ docType: "gst", expiryDate: "2000-01-01" })], source: "api",
    });
    vi.mocked(dm.getDocumentTypes).mockResolvedValue({
      data: [type({ code: "gst", name: "GST cert", mandatory: false, expiryRequired: true })], source: "api",
    });
    render(<DocumentAlertsView subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText(/^Expired$/i)).toBeInTheDocument();
  });
});
