import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  // Read live from the URL so each test controls it via history.replaceState.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { NewAaForm } from "./NewAaForm";

const WORK_ID = "123e4567-e89b-12d3-a456-426614174000";
const AUTH_ID = globalThis.crypto.randomUUID();

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

async function selectWorkAndAuthority() {
  fireEvent.focus(screen.getByLabelText("Work"));
  fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
  fireEvent.mouseDown(await screen.findByText("WK/2026/001"));
  fireEvent.focus(screen.getByLabelText("Approving authority"));
  fireEvent.change(screen.getByLabelText("Approving authority"), { target: { value: "Officer" } });
  fireEvent.mouseDown(await screen.findByText("A. Officer"));
  fireEvent.change(screen.getByLabelText(/AA Number/i), { target: { value: "AA/2026-27/001" } });
  fireEvent.change(screen.getByLabelText(/Approval date/i), { target: { value: "2026-08-26" } });
}

// A fetch stub that serves the EntityPicker adapters' reads (proposals /
// identity users) and the create POST, so the picker can resolve/search and
// the confirm can submit.
function stubFetch(createResponse: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/v1/works/proposals")) {
      return new Response(JSON.stringify({ data: [{ id: WORK_ID, workNumber: "WK/2026/001", description: "Road work", status: "dao_finalized" }] }), { status: 200 });
    }
    if (url.includes("/v1/identity/users")) {
      return new Response(JSON.stringify({ data: [{ id: AUTH_ID, name: "A. Officer", designation: "DAO" }] }), { status: 200 });
    }
    if (url.includes("/v1/works/approvals/aa") && (init?.method ?? "GET") === "POST") {
      return createResponse;
    }
    return new Response("{}", { status: 200 });
  });
}

describe("NewAaForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    window.history.replaceState({}, "", "/works/approvals/new");
  });

  it("pre-fills the Work picker from the ?workId param (context is not dropped)", async () => {
    window.history.replaceState({}, "", `/works/approvals/new?workId=${WORK_ID}`);
    stubFetch(new Response(JSON.stringify({ id: "aa1", status: "accepted" }), { status: 202 }));
    renderWithToast(<NewAaForm />);
    // The picker resolves the prefilled id to its work number via the adapter.
    await waitFor(() => expect(screen.getByText("Pre-filled from the selected proposal.")).toBeInTheDocument());
    const combo = screen.getByLabelText("Work") as HTMLInputElement;
    await waitFor(() => expect(combo.value).toBe("WK/2026/001"));
  });

  it("requires an explicit confirm before POSTing, and converts rupees to paise with BigInt (no float)", async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: "aa1", status: "accepted" }), { status: 202 }));
    renderWithToast(<NewAaForm />);

    // Choose a work from the picker.
    fireEvent.focus(screen.getByLabelText("Work"));
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
    fireEvent.mouseDown(await screen.findByText("WK/2026/001"));

    // Choose an approving authority.
    fireEvent.focus(screen.getByLabelText("Approving authority"));
    fireEvent.change(screen.getByLabelText("Approving authority"), { target: { value: "Officer" } });
    fireEvent.mouseDown(await screen.findByText("A. Officer"));

    fireEvent.change(screen.getByLabelText(/AA Number/i), { target: { value: "AA/2026-27/001" } });
    fireEvent.change(screen.getByLabelText(/Approval date/i), { target: { value: "2026-08-26" } });
    fireEvent.change(screen.getByLabelText(/Approved amount/i), { target: { value: "500000" } });

    // Submitting the form opens a confirm dialog — it must NOT POST yet.
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const postCalls = () => fetchSpy.mock.calls.filter(([u, i]) => String(u).includes("/approvals/aa") && (i as RequestInit)?.method === "POST");
    expect(postCalls()).toHaveLength(0);

    // Confirm fires the POST with BigInt-exact paise.
    const dialogConfirm = screen.getAllByRole("button", { name: "Create" }).pop()!;
    fireEvent.click(dialogConfirm);
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, init] = postCalls()[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.workId).toBe(WORK_ID);
    expect(body.approvingAuthorityId).toBe(AUTH_ID);
    expect(body.approvedAmountMinor).toBe("50000000"); // ₹500000.00 -> paise

    await waitFor(() =>
      expect(
        screen.getByText("Administrative approval submitted. It will appear in the register once processed."),
      ).toBeInTheDocument(),
    );
  });

  it("leaves the Work picker blank (and shows no pre-fill hint) when arrived at without a param", () => {
    stubFetch(new Response(JSON.stringify({ id: "aa1", status: "accepted" }), { status: 202 }));
    renderWithToast(<NewAaForm />);
    expect((screen.getByLabelText("Work") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Pre-filled from the selected proposal.")).not.toBeInTheDocument();
  });

  it("carries the pre-filled workId into the create request and reports 202 as submitted, not created (202 != done)", async () => {
    window.history.replaceState({}, "", `/works/approvals/new?workId=${WORK_ID}`);
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: "aa1", status: "accepted" }), { status: 202 }));
    renderWithToast(<NewAaForm />);
    await waitFor(() => expect((screen.getByLabelText("Work") as HTMLInputElement).value).toBe("WK/2026/001"));
    fireEvent.focus(screen.getByLabelText("Approving authority"));
    fireEvent.change(screen.getByLabelText("Approving authority"), { target: { value: "Officer" } });
    fireEvent.mouseDown(await screen.findByText("A. Officer"));
    fireEvent.change(screen.getByLabelText(/AA Number/i), { target: { value: "AA/2026-27/001" } });
    fireEvent.change(screen.getByLabelText(/Approval date/i), { target: { value: "2026-08-26" } });
    fireEvent.change(screen.getByLabelText(/Approved amount/i), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Create" }).pop()!);

    await waitFor(() =>
      expect(
        screen.getByText("Administrative approval submitted. It will appear in the register once processed."),
      ).toBeInTheDocument(),
    );
    const post = fetchSpy.mock.calls.find(([u, i]) => String(u).includes("/approvals/aa") && (i as RequestInit)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string).workId).toBe(WORK_ID);
    expect(screen.queryByText(/created successfully/i)).not.toBeInTheDocument();
  });

  it("rejects an amount with more than two decimals before any confirm/POST", async () => {
    stubFetch(new Response(JSON.stringify({ id: "aa1", status: "accepted" }), { status: 202 }));
    renderWithToast(<NewAaForm />);
    await selectWorkAndAuthority();
    fireEvent.change(screen.getByLabelText(/Approved amount/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/valid amount in rupees/i)).toBeInTheDocument();
    // No confirm dialog opened (only the submit button named "Create" exists).
    expect(screen.getAllByRole("button", { name: "Create" })).toHaveLength(1);
  });

  it("shows a clerk-safe message, never the raw HTTP status or backend text, when the create fails (UX-016)", async () => {
    stubFetch(
      new Response(JSON.stringify({ message: "duplicate aa_number constraint violated" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    renderWithToast(<NewAaForm />);

    await selectWorkAndAuthority();
    fireEvent.change(screen.getByLabelText(/Approved amount/i), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const dialogConfirm = screen.getAllByRole("button", { name: "Create" }).pop()!;
    fireEvent.click(dialogConfirm);

    const alert = await screen.findByText(/couldn.t save/i);
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/duplicate aa_number/i);
  });
});
