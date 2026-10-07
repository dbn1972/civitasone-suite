import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0 }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const { container } = render(<HandoverPanel />);
    await waitFor(() => expect(container.querySelectorAll("select").length).toBe(3));

    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: OPS[0].employeeId } }); // from
    fireEvent.change(selects[1], { target: { value: OPS[1].employeeId } }); // to

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
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0 }));
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
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0 }));
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
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0 }));
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
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0 }));
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
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 0 }));
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
      if (url.includes("/held-count")) return Promise.resolve(jsonResponse({ count: 7 }));
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
