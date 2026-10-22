import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import EstabFilesListPage from "./page";

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    fileNo: "F/2026/001",
    subject: "Budget allocation for Q3",
    classification: "unclassified" as const,
    department: "Finance",
    createdBy: "—",
    createdDate: "2026-09-01",
    currentHolder: undefined,
    status: "active" as const,
    dueDate: undefined,
    tags: [],
    ...overrides,
  };
}

// The page reads the register (first call) and the dashboard counts (second call).
const DASH = {
  filesActive: 7, filesPending: 7, meetingsToday: 0, vehiclesInUse: 0, complianceItemsDue: 0,
  slaBreached: 2, dakPending: 0, avgPendencyDays: 4.5,
};

function installDefaults() {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockImplementation(async (path: unknown) =>
    String(path).includes("/estab/dashboard") ? { data: DASH, source: "api" } : { data: [], source: "api" });
}

/** The value shown on the stat tile with this label. */
function tileValue(container: HTMLElement, label: string): string | undefined {
  const tile = Array.from(container.querySelectorAll(".stat")).find((el) => el.querySelector(".lab")?.textContent === label);
  return tile?.querySelector(".val")?.textContent ?? undefined;
}

describe("EstabFilesListPage", () => {
  beforeEach(() => {
    installDefaults();
  });

  it("GAP-ESTAB-LIST-01: masks subject for secret/top_secret files", async () => {
    const files = [
      makeFile({ id: "f1", classification: "secret", subject: "Sensitive cabinet note" }),
      makeFile({ id: "f2", classification: "top_secret", subject: "Very sensitive ops" }),
      makeFile({ id: "f3", classification: "confidential", subject: "Tender for road work" }),
    ];
    fetchJsonMock.mockResolvedValueOnce({ data: files, source: "api" });

    const ui = await EstabFilesListPage();
    render(ui);

    // Secret and top_secret subjects should be masked.
    expect(screen.queryByText("Sensitive cabinet note")).not.toBeInTheDocument();
    expect(screen.queryByText("Very sensitive ops")).not.toBeInTheDocument();
    expect(screen.getAllByText("[Classified]")).toHaveLength(2);
    // Confidential is visible.
    expect(screen.getByText("Tender for road work")).toBeInTheDocument();
  });

  it("GAP-ESTAB-LIST-02: stat label reads 'Closed', not 'Closed (MTD)'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ status: "archived" })], source: "api" });
    const ui = await EstabFilesListPage();
    const { container } = render(ui);

    const labs = Array.from(container.querySelectorAll(".lab"));
    expect(labs.some((l) => l.textContent === "Closed")).toBe(true);
    expect(labs.some((l) => l.textContent?.includes("MTD"))).toBe(false);
  });

  it("GAP-ESTAB-FILES-DETAIL-01: a closed file counts under Closed, not Active (the service writes status 'closed' on close)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        makeFile({ id: "f1", fileNo: "F/OPEN", status: "active" }),
        makeFile({ id: "f2", fileNo: "F/SHUT", status: "closed" }),
        makeFile({ id: "f3", fileNo: "F/ARCH", status: "archived" }),
      ],
      source: "api",
    });
    const { container } = render(await EstabFilesListPage());
    const tile = (label: string) => Array.from(container.querySelectorAll(".lab")).find((l) => l.textContent === label)?.parentElement as HTMLElement;
    expect(tile("Closed").textContent).toContain("2");
    expect(tile("Active Files").textContent).toContain("1");
  });

  it("GAP-ESTAB-LIST-03: banner does not promise SLA on pendency", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await EstabFilesListPage();
    render(ui);

    expect(screen.queryByText(/SLA on pendency/)).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-LIST-04: only one primary button; Guided File is ghost", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await EstabFilesListPage();
    const { container } = render(ui);

    // PageHeader actions: Guided File = btn ghost, Create File = btn primary.
    const primaryBtns = container.querySelectorAll(".ph .btn.primary");
    expect(primaryBtns.length).toBe(1);
    expect(primaryBtns[0]?.textContent).toContain("Create File");
  });

  it("GAP-ESTAB-LIST-05: classification shows capitalised label", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ classification: "top_secret", subject: "x" })], source: "api" });
    const ui = await EstabFilesListPage();
    render(ui);

    expect(screen.getByText("Top Secret")).toBeInTheDocument();
  });

  it("GAP-ESTAB-LIST-06: segment reads 'Pending' not 'In transit'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ status: "pending" })], source: "api" });
    const ui = await EstabFilesListPage();
    render(ui);

    // Segment control should show "Pending", not "In transit".
    expect(screen.queryByText("In transit")).not.toBeInTheDocument();
    // "Pending" appears in both the stat label and the segment control.
    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(2);
  });
});

describe("EstabFilesListPage — office-wide tiles share the dashboard's definition (GAP-ESTAB-DASHBOARD-01 / -02)", () => {
  beforeEach(() => {
    installDefaults();
  });

  it("'Active Files' shows the service's count of status=active files, not a count of the rows on this page", async () => {
    // Three active rows on the page, but the office has 7 (the dashboard tile shows the same 7).
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ id: "a" }), makeFile({ id: "b" }), makeFile({ id: "c" })], source: "api" });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Active Files")).toBe("7");
  });

  it("'Avg Pendency' is the service's average over every open file (the dashboard's number), not over the 'pending' rows", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ id: "a" })], source: "api" });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Avg Pendency")).toBe("4.5 days");
  });

  it("when the dashboard counts cannot be read the two tiles say so ('—') instead of showing a page-local number", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [makeFile({ id: "a" })], source: "api" });
    fetchJsonMock.mockResolvedValueOnce({ data: { ...DASH, filesActive: 0, avgPendencyDays: 0 }, source: "error" });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Active Files")).toBe("—");
    expect(tileValue(container, "Avg Pendency")).toBe("—");
    // the register itself still renders
    expect(screen.getByText("Budget allocation for Q3")).toBeInTheDocument();
    // ...and the dashes are explained on the page, not left bare
    expect(screen.getByRole("status")).toHaveTextContent(/could not be loaded/i);
  });

  it("'Closed' counts every finished file: closed, archived and disposed", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        makeFile({ id: "c", status: "closed" }),
        makeFile({ id: "a", status: "archived" }),
        makeFile({ id: "d", status: "disposed" }),
        makeFile({ id: "x", status: "active" }),
      ],
      source: "api",
    });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Closed")).toBe("3");
  });

  it("carries the same hint as the dashboard tile so the two read as one figure", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const { container } = render(await EstabFilesListPage());
    const tile = Array.from(container.querySelectorAll(".stat")).find((el) => el.querySelector(".lab")?.textContent === "Active Files");
    expect(tile?.getAttribute("title")).toMatch(/same count as Active Files on the Dashboard/);
  });
});

// GET /v1/estab/dashboard is gated to estab_officer, estab_admin, section_officer and super_admin; the
// register is also open to estab_deputy_secretary and audit_officer, who get a 403 from it.
describe("EstabFilesListPage when the viewer's role cannot read the dashboard (403)", () => {
  const NOW = new Date("2026-10-21T10:00:00+05:30");
  const day = (n: number) => new Date(NOW.getTime() - n * 24 * 3_600_000).toISOString();

  function serve(files: unknown[] | "error", dash: Record<string, unknown>) {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockImplementation(async (path: unknown) => {
      if (String(path).includes("/estab/dashboard")) return dash;
      return files === "error" ? { data: [], source: "error" } : { data: files, source: "api" };
    });
  }
  const FORBIDDEN = { data: { ...DASH, filesActive: 0, avgPendencyDays: 0 }, source: "error", status: 403 };
  const OPEN_FILES = [
    makeFile({ id: "a", status: "active", createdDate: day(10) }),
    makeFile({ id: "b", status: "active", createdDate: day(2) }),
    makeFile({ id: "c", status: "draft", createdDate: day(3) }),
    makeFile({ id: "d", status: "closed", createdDate: day(300) }),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the loaded rows' own Active Files count under a label that says so, never under the dashboard's label", async () => {
    serve(OPEN_FILES, FORBIDDEN);
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Active Files (loaded)")).toBe("2");
    expect(tileValue(container, "Active Files")).toBeUndefined();
  });

  it("shows Avg Pendency over the loaded open files (closed files excluded) under a 'loaded' label", async () => {
    serve(OPEN_FILES, FORBIDDEN);
    const { container } = render(await EstabFilesListPage());
    // (10 + 2 + 3) / 3 days
    expect(tileValue(container, "Avg Pendency (loaded)")).toBe("5 days");
    expect(tileValue(container, "Avg Pendency")).toBeUndefined();
  });

  it("explains the figures in a visible notice and on each tile's hint", async () => {
    serve(OPEN_FILES, FORBIDDEN);
    const { container } = render(await EstabFilesListPage());
    expect(screen.getByRole("status")).toHaveTextContent(/cannot open the Dashboard.*only the files loaded/i);
    const tile = Array.from(container.querySelectorAll(".stat")).find((el) => el.querySelector(".lab")?.textContent === "Active Files (loaded)");
    expect(tile?.getAttribute("title")).toMatch(/only the files loaded/i);
  });

  it("an empty register reads 0 Active Files and a dash for pendency, not a made-up average", async () => {
    serve([], FORBIDDEN);
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Active Files (loaded)")).toBe("0");
    expect(tileValue(container, "Avg Pendency (loaded)")).toBe("—");
  });

  it("when the register itself also failed to load there is nothing to count, so both tiles read '—'", async () => {
    serve("error", FORBIDDEN);
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Active Files")).toBe("—");
    expect(tileValue(container, "Avg Pendency")).toBe("—");
    expect(screen.getByRole("status")).toHaveTextContent(/cannot open the Dashboard/i);
  });

  it("a viewer who can read the dashboard sees its figures and no notice", async () => {
    serve(OPEN_FILES, { data: DASH, source: "api" });
    const { container } = render(await EstabFilesListPage());
    expect(tileValue(container, "Active Files")).toBe("7");
    expect(tileValue(container, "Avg Pendency")).toBe("4.5 days");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
