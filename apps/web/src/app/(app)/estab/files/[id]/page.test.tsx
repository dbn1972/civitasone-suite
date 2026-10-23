import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// ScannedDocumentsSection is an async server component (calls getTranslations)
// that is irrelevant to the note-sheet rendering under test — stub it so the
// synchronous render tree doesn't suspend on it.
vi.mock("./ScannedDocumentsSection", () => ({
  ScannedDocumentsSection: () => null,
}));
// OfficerName fires client fetches for name resolution; stub to the short id so
// the test is deterministic and offline.
vi.mock("./OfficerName", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./OfficerName")>()),
  OfficerName: ({ id }: { id: string }) => <span>Officer {id.slice(0, 8)}</span>,
}));

import EstabFileDetailPage from "./page";

describe("EstabFileDetailPage — not-found vs error (L3)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("shows a retryable load error (NOT a false 'File not found') when the fetch fails", async () => {
    // 404, 5xx and network all collapse to source:"error" — never claim the
    // file was lost during a backend blip.
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await EstabFileDetailPage({ params: { id: "f1" } });
    render(ui);

    expect(screen.queryByText("File not found")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("EstabFileDetailPage — note sheet when/officer/signedAt (FILES-DETAIL-05/06)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders a When column, an officer render and the signed-at time for a green note", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        id: "f1",
        fileNo: "ESTAB-A/00007/2026",
        subject: "Pay revision proposal",
        classification: "confidential",
        department: "ADMIN",
        createdBy: "u1",
        createdDate: "2026-09-01T00:00:00.000Z",
        currentHolder: "11111111-1111-4111-8111-111111111111",
        status: "active",
        tags: [],
        noteSheets: [
          {
            id: "n2",
            author: "22222222-2222-4222-8222-222222222222",
            content: "Approved at my level.",
            timestamp: "2026-09-20T09:30:00.000Z",
            type: "note",
            noteType: "green",
            noteStatus: "signed",
            eSigned: true,
            signedAt: "2026-09-20T09:35:00.000Z",
          },
          {
            id: "n1",
            author: "33333333-3333-4333-8333-333333333333",
            content: "Draft proposal.",
            timestamp: "2026-09-18T08:00:00.000Z",
            type: "note",
            noteType: "yellow",
            noteStatus: "draft",
            eSigned: false,
            signedAt: null,
          },
        ],
        dispatchHistory: [],
        attachments: [],
        movementHistory: [],
      },
    });

    const ui = await EstabFileDetailPage({ params: { id: "f1" } });
    render(ui);

    // When column header is present (date/time now shown per row).
    expect(screen.getByText("When")).toBeInTheDocument();
    // Officer column header is present.
    expect(screen.getAllByText(/Officer/i).length).toBeGreaterThan(0);
    // The signed-at time is shown for the green note (at least one element).
    expect(screen.getAllByText(/signed/i).length).toBeGreaterThan(0);
    // The draft note content and the green note content both render.
    expect(screen.getByText("Draft proposal.")).toBeInTheDocument();
    expect(screen.getByText("Approved at my level.")).toBeInTheDocument();
    // A signed note is called what it is (signed into the hash-chained trail, no DSC), never "e-Signed".
    expect(screen.getByText(/Green \(approved\) · Signed \(hash-chained note\)/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/e-Signed/i);
  });
});

describe("EstabFileDetailPage - service-resolved officer names (SF-17b)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the resolved author and holder names directly, and the localised fallback when unresolved", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        id: "f1",
        fileNo: "ESTAB-A/00008/2026",
        subject: "Names",
        classification: "confidential",
        department: "ADMIN",
        createdBy: "Creator Name",
        createdDate: "2026-09-01T00:00:00.000Z",
        currentWith: "11111111-1111-4111-8111-111111111111",
        currentHolder: "Meera Iyer",
        status: "active",
        noteSheets: [
          { id: "n1", author: "Anita Desai", content: "Resolved note.", timestamp: "2026-09-18T08:00:00.000Z", type: "note", noteType: "yellow", noteStatus: "draft", eSigned: false, signedAt: null },
          { id: "n2", author: null, content: "Unresolved note.", timestamp: "2026-09-19T08:00:00.000Z", type: "note", noteType: "yellow", noteStatus: "draft", eSigned: false, signedAt: null },
        ],
        dispatchHistory: [],
        attachments: [],
        movementHistory: [],
      },
    });

    const ui = await EstabFileDetailPage({ params: { id: "f1" } });
    render(ui);

    expect(screen.getByText("Anita Desai")).toBeInTheDocument();
    expect(screen.getByText("Meera Iyer")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown employee")).toHaveLength(1);
  });
});


function detail(over: Record<string, unknown> = {}) {
  return {
    id: "f1", fileNo: "ESTAB-A/00009/2026", subject: "Selection", classification: "confidential", department: "ADMIN",
    createdBy: "u1", createdDate: "2026-09-01T00:00:00.000Z", currentHolder: "Meera Iyer", status: "active", tags: [],
    noteSheets: [], dispatchHistory: [], attachments: [], movementHistory: [], ...over,
  };
}
const note = (id: string, over: Record<string, unknown> = {}) => ({
  id, author: "Anita Desai", content: `Content of ${id}`, timestamp: "2026-09-18T08:00:00.000Z", type: "note",
  noteType: "yellow", noteStatus: "draft", eSigned: false, signedAt: null, ...over,
});

describe("EstabFileDetailPage — which draft Submit and Sign act on (GAP-ESTAB-FILES-DETAIL-03)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); vi.restoreAllMocks(); });

  it("with several notes, Sign acts on the LATEST yellow DRAFT — not an older draft, a submitted note, or a green one", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: detail({
        noteSheets: [
          // The OLDER draft is listed first and the newer one second, so a plain "first draft in
          // array order" pick (a .find()) would sign n-draft-older: only a sort by timestamp
          // passes this test.
          note("n-draft-older", { timestamp: "2026-09-10T08:00:00.000Z" }),
          note("n-draft-newer", { timestamp: "2026-09-18T08:00:00.000Z" }),
          note("n-later-submitted", { timestamp: "2026-09-15T08:00:00.000Z", noteStatus: "submitted" }),
          note("n-latest-green", { timestamp: "2026-09-20T08:00:00.000Z", noteType: "green", noteStatus: "approved", eSigned: true, signedAt: "2026-09-20T09:35:00.000Z" }),
        ],
      }),
    });
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });

    render(await EstabFileDetailPage({ params: { id: "f1" } }));
    fireEvent.click(screen.getByRole("button", { name: "Sign note (green)" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Sign note") as HTMLElement);
    await waitFor(() => expect(urls.some((u) => u.includes("/sign"))).toBe(true));
    // The draft of 18 Sep is the newest draft (the 10 Sep one is older, though listed first);
    // neither the submitted note of 15 Sep nor the green one of 20 Sep is a draft.
    expect(urls.filter((u) => u.includes("/sign"))).toEqual(["/api/proxy/v1/estab/files/f1/notings/n-draft-newer/sign"]);
  });

  it("with no yellow draft, Submit and Sign are disabled and the officer is told to save a note first", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: detail({ noteSheets: [note("n-sub", { noteStatus: "submitted" })] }),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(await EstabFileDetailPage({ params: { id: "f1" } }));
    expect(screen.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign note (green)" })).toBeDisabled();
    expect(screen.getByText(/Save a yellow note first/)).toBeInTheDocument();
  });
});

describe("EstabFileDetailPage — note sheet shows date AND time, and the signature time (GAP-ESTAB-FILES-DETAIL-05)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("shows the time of day in When and the signing time beside a green note; an unsigned note shows no signature time", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: detail({
        noteSheets: [
          note("n1", { timestamp: "2026-09-18T08:00:00.000Z" }),
          note("n2", { timestamp: "2026-09-20T09:30:00.000Z", noteType: "green", noteStatus: "approved", eSigned: true, signedAt: "2026-09-20T09:35:00.000Z" }),
        ],
      }),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(await EstabFileDetailPage({ params: { id: "f1" } }));

    const rows = screen.getAllByRole("row").filter((r) => r.textContent?.includes("Content of"));
    expect(rows).toHaveLength(2);
    // 08:00 UTC = 01:30 pm IST; 09:30 UTC = 03:00 pm IST; 09:35 UTC = 03:05 pm IST.
    expect(rows[0]?.textContent).toMatch(/18 Sep 2026, 0?1:30 pm/i);
    expect(rows[0]?.textContent).not.toMatch(/signed/i);
    expect(rows[1]?.textContent).toMatch(/20 Sep 2026, 0?3:00 pm/i);
    expect(rows[1]?.textContent).toMatch(/\(signed 20 Sep 2026, 0?3:05 pm\)/i);
  });
});

describe("EstabFileDetailPage — a closed file is read-only (GAP-ESTAB-FILES-DETAIL-01)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  for (const status of ["closed", "archived"]) {
    it(`a ${status} file shows the read-only notice and none of Save note / Submit / Sign / Refer`, async () => {
      fetchJsonMock.mockResolvedValue({ source: "api", data: detail({ status, noteSheets: [note("n1")] }) });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      render(await EstabFileDetailPage({ params: { id: "f1" } }));
      expect(screen.getByText(new RegExp(`This file is ${status}; no further noting`))).toBeInTheDocument();
      for (const name of ["Save yellow note", "Submit for approval", "Sign note (green)", "Refer back"]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
    });
  }
});

describe("EstabFileDetailPage - the allocated file number after create (GAP-ESTAB-FILES-NEW-06)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  const FILE = {
    id: "f1",
    fileNo: "ESTAB-A/00042/2026",
    subject: "Fresh file",
    classification: "unclassified",
    department: "ADMIN",
    createdBy: "",
    createdDate: "2026-10-22",
    currentHolder: "",
    status: "active",
    noteSheets: [],
    dispatchHistory: [],
    attachments: [],
    movementHistory: [],
  };

  it("arriving with ?created=1 shows the file number the service allocated, in a status banner", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: FILE });
    render(await EstabFileDetailPage({ params: { id: "f1" }, searchParams: { created: "1" } }));
    const banner = screen.getByText(/File ESTAB-A\/00042\/2026 has been created/);
    expect(banner.getAttribute("role")).toBe("status");
  });

  it("without the flag there is no created banner (the number is still the page title)", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: FILE });
    render(await EstabFileDetailPage({ params: { id: "f1" } }));
    expect(screen.queryByText(/has been created/)).toBeNull();
    expect(screen.getByText(/ESTAB-A\/00042\/2026 · Fresh file/)).toBeInTheDocument();
  });

  it("?created=1 before the create command has been processed says it is being created, with a refresh link (not an error)", async () => {
    // The file does not exist yet: the loader collapses that 404 into source "error".
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await EstabFileDetailPage({ params: { id: "f1" }, searchParams: { created: "1" } }));
    expect(screen.getByText("Creating your file…")).toBeInTheDocument();
    expect(screen.getByText(/file number is assigned as soon as it is processed/).getAttribute("role")).toBe("status");
    expect(screen.getByRole("link", { name: "Refresh" })).toHaveAttribute("href", "/estab/files/f1?created=1");
    // Not the "couldn't load the file" error state.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("?created=1 with a real failure (not a 404) is still the ordinary retryable error, not 'being created'", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await EstabFileDetailPage({ params: { id: "f1" }, searchParams: { created: "1" } }));
    expect(screen.queryByText("Creating your file…")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
