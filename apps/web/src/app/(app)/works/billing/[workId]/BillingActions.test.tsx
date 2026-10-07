import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { BillingActions } from "./BillingActions";

const WORK = "11111111-1111-1111-1111-111111111111";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Default MB-list fetch returns empty so the MB card is absent unless a test
 * provides its own mock. */
function mockMbList(rows: unknown[] = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(((url: RequestInfo | URL) => {
    if (String(url).endsWith(`/billing/${WORK}/mbs`)) {
      return Promise.resolve(new Response(JSON.stringify({ data: rows }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ data: { id: "x", status: "ok" } }), { status: 202 }));
  }) as typeof fetch);
}

describe("BillingActions — WORKID-02 next-step gating", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("offers an Advance button for an in-sequence bill (so_finalized → sdo)", async () => {
    mockMbList();
    renderWithToast(
      <BillingActions workId={WORK} canFinalize bills={[{ id: "b1", billNo: "BILL/001", status: "so_finalized" }]} />,
    );
    expect(await screen.findByRole("button", { name: /→ Sdo finalized/i })).toBeInTheDocument();
  });

  it("offers NO Advance button for an already-submitted bill (was: spurious → So finalized)", async () => {
    mockMbList();
    renderWithToast(
      <BillingActions workId={WORK} canFinalize bills={[{ id: "b1", billNo: "BILL/001", status: "submitted" }]} />,
    );
    // No "Finalize Bills" card at all when nothing is actionable.
    await waitFor(() => expect(screen.queryByText("Finalize Bills")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /→/ })).not.toBeInTheDocument();
  });

  it("offers NO Advance button for a terminal do_finalized bill", async () => {
    mockMbList();
    renderWithToast(
      <BillingActions workId={WORK} canFinalize bills={[{ id: "b1", billNo: "BILL/001", status: "do_finalized" }]} />,
    );
    await waitFor(() => expect(screen.queryByText("Finalize Bills")).not.toBeInTheDocument());
  });
});

describe("BillingActions — WORKID-03 role gating", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders no irreversible controls when the user lacks the finalize role", async () => {
    mockMbList([{ id: "mb1", mbNumber: "MB/001", status: "sdo_finalized" }]);
    renderWithToast(
      <BillingActions workId={WORK} canFinalize={false} bills={[{ id: "b1", billNo: "BILL/001", status: "so_finalized" }]} />,
    );
    // Neither finalize card nor any Advance button is offered.
    await waitFor(() => expect(screen.queryByText("Finalize Bills")).not.toBeInTheDocument());
    expect(screen.queryByText("Finalize Measurement Books")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /→/ })).not.toBeInTheDocument();
  });

  it("names the authority and the from→to transition in the confirm dialog", async () => {
    mockMbList();
    renderWithToast(
      <BillingActions workId={WORK} canFinalize bills={[{ id: "b1", billNo: "BILL/001", status: "dao_finalized" }]} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /→ Do finalized/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Divisional Officer \(DO\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/from "Dao finalized" to "Do finalized"/)).toBeInTheDocument();
  });
});

describe("BillingActions — WORKID-04 MB list (no paste-a-UUID)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders MBs from the list endpoint with a single next-step button, and no UUID input", async () => {
    mockMbList([{ id: "mb1", mbNumber: "MB/2024-25/001", status: "sdo_finalized" }]);
    renderWithToast(<BillingActions workId={WORK} canFinalize bills={[]} />);

    expect(await screen.findByText("MB/2024-25/001")).toBeInTheDocument();
    // next step for sdo_finalized in the MB sequence is estimator_finalized
    expect(screen.getByRole("button", { name: /→ Estimator finalized/i })).toBeInTheDocument();
    // the old paste-UUID affordance is gone
    expect(screen.queryByPlaceholderText("Paste full MB UUID")).not.toBeInTheDocument();
  });

  it("does not list an already do_finalized MB (terminal)", async () => {
    mockMbList([{ id: "mb1", mbNumber: "MB/DONE", status: "do_finalized" }]);
    renderWithToast(<BillingActions workId={WORK} canFinalize bills={[]} />);
    await waitFor(() => expect(screen.queryByText("Finalize Measurement Books")).not.toBeInTheDocument());
  });
});

describe("BillingActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw server text, when a bill finalize fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: RequestInfo | URL) => {
      if (String(url).endsWith(`/billing/${WORK}/mbs`)) {
        return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response("Conflict: bill already at this status", { status: 409 }));
    }) as typeof fetch);

    renderWithToast(
      <BillingActions workId={WORK} canFinalize bills={[{ id: "b1", billNo: "BILL/001", status: "so_finalized" }]} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /→ Sdo finalized/i }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Advance" }));

    await waitFor(() =>
      expect(
        screen.getByText(/This bill was changed by someone else\. Refresh to see the latest version, then try again\./),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Conflict: bill already at this status/)).not.toBeInTheDocument();
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw server text, when an MB finalize fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: RequestInfo | URL) => {
      if (String(url).endsWith(`/billing/${WORK}/mbs`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "mb1", mbNumber: "MB/2024-25/001", status: "sdo_finalized" }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("Conflict: mb already at this status", { status: 409 }));
    }) as typeof fetch);

    renderWithToast(<BillingActions workId={WORK} canFinalize bills={[]} />);

    fireEvent.click(await screen.findByRole("button", { name: /→ Estimator finalized/i }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Advance" }));

    await waitFor(() => expect(screen.getAllByText(/was changed by someone else/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Conflict: mb already at this status/)).not.toBeInTheDocument();
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });
});
