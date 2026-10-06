import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

// GAP-DOCUMENTS-LIBRARY-07: the page now reads its strings from the
// `documentsLibrary` i18n namespace; mock next-intl/server to serve the real
// catalogue (swapped per-test to prove the hi locale renders translated text).
import enMsgs from "@/messages/en.json";
import hiMsgs from "@/messages/hi.json";
let messages: Record<string, unknown> = enMsgs as Record<string, unknown>;
function resolveMsg(ns: string, key: string, params?: Record<string, unknown>): string {
  const hit = `${ns}.${key}`.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
  if (typeof hit !== "string") throw new Error(`missing message ${ns}.${key}`);
  return params ? hit.replace(/\{(\w+)\}/g, (_m, p) => String(params[p] ?? "")) : hit;
}
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string, params?: Record<string, unknown>) => resolveMsg(ns, key, params),
}));

const getDocumentFiles = vi.fn();
const getDocumentFolders = vi.fn();
const getDocumentStats = vi.fn();
vi.mock("../_data/loaders", () => ({
  getDocumentFiles: (id?: string) => getDocumentFiles(id),
  getDocumentFolders: () => getDocumentFolders(),
  getDocumentStats: () => getDocumentStats(),
}));

import DocumentLibraryPage, { mimeLabel, fileStatusTone } from "./page";

const FOLDER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const STATS = { inboxCount: 3, pendingCount: 1, urgentCount: 2, inboxUrgentCount: 0, inboxPendingCount: 0, inboxForwardedCount: 0 };

function file(over: Partial<Record<string, unknown>> = {}) {
  return { id: "f1", name: "doc.docx", folderId: null, mimeType: WORD_MIME, sizeBytes: 1234, tags: [], status: "active", version: 1, updatedAt: "2026-09-01T00:00:00Z", ...over };
}
function folder(over: Partial<Record<string, unknown>> = {}) {
  return { id: FOLDER_ID, name: "Budget", parentId: null, path: "/Budget", ...over };
}

describe("DocumentLibraryPage", () => {
  beforeEach(() => { getDocumentFiles.mockReset(); getDocumentFolders.mockReset(); getDocumentStats.mockReset(); messages = enMsgs as Record<string, unknown>; });

  it("LIBRARY-01: a folder row has 6+1 aligned cells, Type cell reads 'Folder', name is a link", async () => {
    getDocumentFiles.mockResolvedValue({ data: [], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [folder()], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentLibraryPage({ searchParams: {} }));
    const link = screen.getByRole("link", { name: /Budget/ });
    expect(link).toHaveAttribute("href", `/documents/library?folderId=${FOLDER_ID}`);
    const row = link.closest("tr")!;
    expect(row.querySelectorAll("td")).toHaveLength(7); // 6 columns + actions
    expect(within(row).getByText("Folder")).toBeInTheDocument();
  });

  it("LIBRARY-02: deleted files are hidden by default and an Actions column exists for active files", async () => {
    getDocumentFiles.mockResolvedValue({ data: [file(), file({ id: "f2", name: "old.docx", status: "deleted" })], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentLibraryPage({ searchParams: {} }));
    expect(screen.getByText("doc.docx", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("old.docx", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Show deleted/ })).toBeInTheDocument();
  });

  it("LIBRARY-02: showDeleted=1 reveals the deleted row", async () => {
    getDocumentFiles.mockResolvedValue({ data: [file({ id: "f2", name: "old.docx", status: "deleted" })], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentLibraryPage({ searchParams: { showDeleted: "1" } }));
    expect(screen.getByText("old.docx", { exact: false })).toBeInTheDocument();
  });

  it("LIBRARY-03: stat labels state their scope", async () => {
    getDocumentFiles.mockResolvedValue({ data: [file()], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentLibraryPage({ searchParams: {} }));
    expect(screen.getByText("Files in this folder")).toBeInTheDocument();
    expect(screen.getByText("Sub-folders")).toBeInTheDocument();
    expect(screen.getByText("Inbox (all)")).toBeInTheDocument();
    expect(screen.getByText("Urgent (all)")).toBeInTheDocument();
  });

  it("LIBRARY-04: a malformed folderId renders the not-found page (notFound thrown)", async () => {
    await expect(DocumentLibraryPage({ searchParams: { folderId: "bogus" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("LIBRARY-04: an unknown but well-formed folderId 404s only when folders loaded", async () => {
    getDocumentFiles.mockResolvedValue({ data: [], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    await expect(DocumentLibraryPage({ searchParams: { folderId: FOLDER_ID } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("LIBRARY-04/05: a folders-fetch error is a retry card, NOT a 404", async () => {
    getDocumentFiles.mockResolvedValue({ data: [], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [], source: "error" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentLibraryPage({ searchParams: { folderId: FOLDER_ID } }));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("LIBRARY-05: a stats-only failure shows a 'Counts unavailable' note and dashes, not an error card", async () => {
    getDocumentFiles.mockResolvedValue({ data: [file()], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "error" });
    render(await DocumentLibraryPage({ searchParams: {} }));
    expect(screen.getByText("Counts unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("LIBRARY-06: a Word file shows 'Word', not the vnd.openxml string; helpers behave", async () => {
    getDocumentFiles.mockResolvedValue({ data: [file()], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentLibraryPage({ searchParams: {} }));
    expect(screen.getByText("Word")).toBeInTheDocument();
    expect(screen.queryByText(WORD_MIME)).not.toBeInTheDocument();
    expect(mimeLabel(WORD_MIME)).toBe("Word");
    expect(mimeLabel("application/pdf")).toBe("PDF");
    expect(fileStatusTone("active")).toBe("good");
    expect(fileStatusTone("deleted")).toBe("bad");
  });

  it("LIBRARY-07: headers come from the i18n catalogue — hi locale renders translated headers", async () => {
    getDocumentFiles.mockResolvedValue({ data: [file()], source: "api" });
    getDocumentFolders.mockResolvedValue({ data: [], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    const en = render(await DocumentLibraryPage({ searchParams: {} }));
    expect(en.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(en.getByText("Files in this folder")).toBeInTheDocument();
    en.unmount();
    messages = hiMsgs as Record<string, unknown>;
    const hi = render(await DocumentLibraryPage({ searchParams: {} }));
    expect(hi.getByRole("columnheader", { name: "नाम" })).toBeInTheDocument();
    expect(hi.getByText("इस फ़ोल्डर की फ़ाइलें")).toBeInTheDocument();
  });
});
