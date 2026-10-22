import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { IntlWrapper } from "@/lib/testUtils/intl";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: IntlWrapper });

import { HandoverPanel } from "./HandoverPanel";
import { __resetOfficerMapsCacheForTest } from "../files/[id]/OfficerName";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const OPS = [
  { id: "op-1", employeeId: "00000000-0000-0000-0000-000000000001", division: "Admin", deskRole: "section_officer", active: true },
  { id: "op-2", employeeId: "00000000-0000-0000-0000-000000000002", division: "Estab", deskRole: "under_secretary", active: true },
];

const OPS_WITH_INACTIVE = [
  ...OPS,
  { id: "op-3", employeeId: "00000000-0000-0000-0000-000000000003", division: "Retd", deskRole: "director", active: false },
];

describe("HandoverPanel — charge handover safety & truthful states", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOfficerMapsCacheForTest();
  });

  it("does NOT reassign charge on a bare click — it opens a ConfirmDialog, and only POSTs after confirming (L4)", async () => {
    const postCalls: unknown[][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") { postCalls.push([url, init]); return Promise.resolve(jsonResponse({})); }
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ data: OPS }));
      if (url.includes("/estab/handovers")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/hrms/employees")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 3, movableCount: 3 }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const { container } = render(<HandoverPanel />);
    await waitFor(() => expect(container.querySelectorAll("select").length).toBe(3));

    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: OPS[0].employeeId } }); // from
    fireEvent.change(selects[1], { target: { value: OPS[1].employeeId } }); // to
    await screen.findByText("3 files will be reassigned.");

    fireEvent.click(screen.getByRole("button", { name: "Hand over charge" }));

    // The bulk reassignment must NOT fire on the click.
    expect(postCalls.some(([u]) => String(u).includes("/handovers"))).toBe(false);

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Hand over charge");
    expect(confirmBtn).toBeTruthy();

    fireEvent.click(confirmBtn!);
    await waitFor(() =>
      expect(postCalls.some(([u]) => String(u).includes("/handovers"))).toBe(true),
    );
  });

  it("shows a real error state (not 'No handovers recorded') when the history load fails (L3)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ data: OPS }));
      if (url.includes("/estab/handovers")) return Promise.resolve(jsonResponse({ message: "boom" }, 500));
      if (url.includes("/hrms/employees")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0, movableCount: 0 }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    render(<HandoverPanel />);

    // A failed load must surface an assertive error with a retry — never the empty state.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("No handovers recorded.")).toBeNull();
  });
});

describe("HandoverPanel — HANDOVER-04/05/06", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOfficerMapsCacheForTest();
  });

  it("HANDOVER-04: marks inactive operators '(inactive)' in the From list", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ data: OPS_WITH_INACTIVE }));
      if (url.includes("/estab/handovers")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/hrms/employees")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0, movableCount: 0 }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const { container } = render(<HandoverPanel />);
    await waitFor(() => expect(container.querySelectorAll("select").length).toBeGreaterThan(0));

    const fromSelect = container.querySelectorAll("select")[0]!;
    const inactiveOption = Array.from(fromSelect.querySelectorAll("option")).find((o) =>
      o.textContent?.includes("Retd"),
    );
    expect(inactiveOption?.textContent).toContain("(inactive)");
  });

  it("HANDOVER-06: renders reason options with Title Case labels, not raw lowercase", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ data: OPS }));
      if (url.includes("/estab/handovers")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/hrms/employees")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0, movableCount: 0 }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const { container } = render(<HandoverPanel />);
    await waitFor(() => expect(container.querySelectorAll("select").length).toBe(3));

    const reasonSelect = container.querySelectorAll("select")[2]!;
    const labels = Array.from(reasonSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toContain("Transfer");
    expect(labels).toContain("Retirement");
    expect(labels).not.toContain("transfer");
  });

  it("HANDOVER-05: a roster load failure blocks the form (no From/To selects) and offers retry", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ message: "boom" }, 500));
      if (url.includes("/estab/handovers")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/hrms/employees")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0, movableCount: 0 }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    render(<HandoverPanel />);

    await screen.findByText("New charge handover");
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
    // Form is blocked: no "Hand over charge" trigger button is rendered.
    expect(screen.queryByRole("button", { name: "Hand over charge" })).toBeNull();
  });
});

describe("HandoverPanel — HANDOVER-01/03 (names + file-count preview)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOfficerMapsCacheForTest();
  });

  it("HANDOVER-01: picker options show the resolved officer NAME, not just a truncated id", async () => {
    // The From/To selects resolve names from the operator roster (shared with
    // OfficerName). A named officer must read as "Asha Rao", not "00000000…".
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) {
        return Promise.resolve(
          jsonResponse({
            data: [
              { ...OPS[0], employeeName: "Asha Rao" },
              { ...OPS[1], employeeName: "Bimal Sen" },
            ],
          }),
        );
      }
      if (url.includes("/estab/handovers")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0, movableCount: 0 }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const { container } = render(<HandoverPanel />);
    await waitFor(() => expect(container.querySelectorAll("select").length).toBe(3));

    await waitFor(() => {
      const fromSelect = container.querySelectorAll("select")[0]!;
      const text = Array.from(fromSelect.querySelectorAll("option")).map((o) => o.textContent).join("|");
      expect(text).toContain("Asha Rao");
      expect(text).toContain("Bimal Sen");
    });
  });

  it("HANDOVER-03: the confirm dialog states the number of files that will move", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/hrms/employees")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ data: OPS }));
      if (url.includes("/estab/handovers")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 7, movableCount: 7 }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const { container } = render(<HandoverPanel />);
    await waitFor(() => expect(container.querySelectorAll("select").length).toBe(3));

    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: OPS[0].employeeId } }); // from
    fireEvent.change(selects[1], { target: { value: OPS[1].employeeId } }); // to

    // Count hint near the button appears after the held-count fetch resolves.
    await screen.findByText("7 files will be reassigned.");

    fireEvent.click(screen.getByRole("button", { name: "Hand over charge" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("all 7 files");
  });
});

// ── HANDOVER-03: the count is the number that moves, and the handover waits for it ─────────

function mockPanel(opts: { held?: () => Response; operators?: () => Response; handovers?: () => Response }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/held-count")) return Promise.resolve(opts.held ? opts.held() : jsonResponse({ count: 0, movableCount: 0 }));
    if (url.includes("/estab/operators")) return Promise.resolve(opts.operators ? opts.operators() : jsonResponse({ data: OPS }));
    if (url.includes("/estab/handovers")) return Promise.resolve(opts.handovers ? opts.handovers() : jsonResponse({ data: [] }));
    return Promise.resolve(jsonResponse({ data: [] }));
  });
}
async function pickOfficers(container: HTMLElement) {
  await waitFor(() => expect(container.querySelectorAll("select").length).toBe(3));
  const selects = container.querySelectorAll("select");
  fireEvent.change(selects[0]!, { target: { value: OPS[0]!.employeeId } });
  fireEvent.change(selects[1]!, { target: { value: OPS[1]!.employeeId } });
}

describe("HandoverPanel - GAP-ESTAB-HANDOVER-03 (preview states exactly what moves; confirm waits for it)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOfficerMapsCacheForTest();
  });

  it("states the number a handover will MOVE, and says the other live files stay put (it never quotes the larger live count)", async () => {
    // 9 live files on the desk, but only 7 are Active: the handover moves 7.
    mockPanel({ held: () => jsonResponse({ count: 9, movableCount: 7 }) });
    const { container } = render(<HandoverPanel />);
    await pickOfficers(container);
    await screen.findByText("7 files will be reassigned.");
    expect(screen.getByText(/2 other files stay with this officer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hand over charge" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("all 7 files");
    expect(dialog.textContent).not.toContain("9 files");
  });

  it("an officer with nothing to move cannot start a handover, and is told why", async () => {
    mockPanel({ held: () => jsonResponse({ count: 2, movableCount: 0 }) });
    const { container } = render(<HandoverPanel />);
    await pickOfficers(container);
    await screen.findByText(/no active files on their desk, so there is nothing to hand over/);
    expect(screen.getByRole("button", { name: "Hand over charge" })).toBeDisabled();
  });

  it("while the count is loading the handover cannot be started", async () => {
    let release: (r: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/held-count")) return new Promise<Response>((res) => { release = res; });
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ data: OPS }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    const { container } = render(<HandoverPanel />);
    await pickOfficers(container);
    await screen.findByText(/Checking how many files this officer holds/);
    expect(screen.getByRole("button", { name: "Hand over charge" })).toBeDisabled();
    release(jsonResponse({ count: 1, movableCount: 1 }));
    await screen.findByText("1 file will be reassigned.");
    expect(screen.getByRole("button", { name: "Hand over charge" })).toBeEnabled();
  });

  it("when the count cannot be fetched the handover is blocked with an alert, and 'Check again' recovers", async () => {
    let calls = 0;
    mockPanel({ held: () => (++calls === 1 ? jsonResponse({ message: "boom" }, 500) : jsonResponse({ count: 4, movableCount: 4 })) });
    const { container } = render(<HandoverPanel />);
    await pickOfficers(container);
    const alert = await screen.findByText(/couldn't check how many files this officer holds/);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Hand over charge" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText("4 files will be reassigned.");
    expect(screen.getByRole("button", { name: "Hand over charge" })).toBeEnabled();
  });

  it("a response without the movable figure is treated as a failed count (no number is vouched for)", async () => {
    mockPanel({ held: () => jsonResponse({ count: 5 }) });
    const { container } = render(<HandoverPanel />);
    await pickOfficers(container);
    await screen.findByText(/couldn't check how many files this officer holds/);
    expect(screen.getByRole("button", { name: "Hand over charge" })).toBeDisabled();
  });
});

// ── HANDOVER-05: the two loads fail independently ─────────────────────────────────────────

describe("HandoverPanel - GAP-ESTAB-HANDOVER-05 (operators vs history failures are distinct)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOfficerMapsCacheForTest();
  });

  it("a history-only 500 leaves the form usable: the officer pickers are populated and a handover can be started", async () => {
    mockPanel({ handovers: () => jsonResponse({ message: "boom" }, 500), held: () => jsonResponse({ count: 2, movableCount: 2 }) });
    const { container } = render(<HandoverPanel />);
    // The history card shows its own error with a retry...
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No handovers recorded.")).toBeNull();
    // ...while the form is intact: both officer pickers list the operators and Hand over is reachable.
    await pickOfficers(container);
    const fromOptions = Array.from(container.querySelectorAll("select")[0]!.querySelectorAll("option")).map((o) => o.value);
    expect(fromOptions).toContain(OPS[0]!.employeeId);
    await screen.findByText("2 files will be reassigned.");
    expect(screen.getByRole("button", { name: "Hand over charge" })).toBeEnabled();
  });

  it("an operators-only 500 blocks the form but the history still loads", async () => {
    mockPanel({
      operators: () => jsonResponse({ message: "boom" }, 500),
      handovers: () => jsonResponse({ data: [{ id: "h1", fromOfficerId: OPS[0]!.employeeId, toOfficerId: OPS[1]!.employeeId, reason: "leave", remarks: null, fileCount: 3, status: "completed", createdAt: "2026-10-01T00:00:00Z" }] }),
    });
    render(<HandoverPanel />);
    await screen.findByText("New charge handover");
    expect(await screen.findByText("Leave")).toBeInTheDocument(); // the history row rendered
    expect(screen.queryByRole("button", { name: "Hand over charge" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1); // only the roster has an error
  });

  it("both failing shows both errors, each with its own retry", async () => {
    mockPanel({ operators: () => jsonResponse({}, 500), handovers: () => jsonResponse({}, 500) });
    render(<HandoverPanel />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Hand over charge" })).toBeNull();
  });
});
