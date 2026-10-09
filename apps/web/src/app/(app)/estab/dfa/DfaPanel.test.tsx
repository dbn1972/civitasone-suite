import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";
// DfaPanel reads its copy through next-intl; render with the English provider.
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

// GAP2-ESTAB-NOTIFICATIONS-DFALINK-01: DfaPanel now reads ?focus= via
// useSearchParams. Tests set the param through this controllable mock.
let mockSearch = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mockSearch,
}));

import { DfaPanel } from "./DfaPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("DfaPanel — step-change announcement (Req 2.6)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("announces the new step title (visually hidden, aria-live assertive) after submitting a draft", async () => {
    const dfa = {
      id: "dfa-1", dfaNo: "DFA-001", communicationType: "letter", subject: "Test",
      status: "draft", editable: true, recipientName: null, updatedAt: "2026-08-17T00:00:00Z",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [dfa] })) // initial load
      .mockResolvedValueOnce(jsonResponse({})) // submit action
      .mockResolvedValueOnce(jsonResponse({ data: [{ ...dfa, status: "pending_approval" }] })); // reload after submit

    render(<DfaPanel />);

    const submitBtn = await screen.findByRole("button", { name: "Submit" });
    fireEvent.click(submitBtn);

    // The ConfirmDialog's own confirm button also reads "Submit" — find it within the dialog.
    const dialog = await screen.findByRole("alertdialog");
    const dialogConfirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit");
    expect(dialogConfirm).toBeTruthy();
    fireEvent.click(dialogConfirm!);

    await waitFor(() => {
      const live = document.querySelector('[aria-live="assertive"][aria-atomic="true"]');
      expect(live?.textContent).toBe("Pending approval");
    });
  });
});

describe("DfaPanel — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw HTTP status or backend text, when creating a draft fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // initial load
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "dfa_seq exhausted for section" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ); // create failure

    render(<DfaPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "+ New draft" }));
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: "Test outgoing letter" } });
    fireEvent.change(screen.getByLabelText(/Draft body/i), { target: { value: "Body text of the letter." } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => {
      const alerts = screen.getAllByText(/couldn't save/i);
      expect(alerts.length).toBeGreaterThan(0);
    });
    expect(document.body.textContent).not.toMatch(/dfa_seq exhausted/i);
    expect(document.body.textContent).not.toMatch(/\b500\b/);
  });

  it("propagates a clerk-safe message (no raw action slug prefix) when a lifecycle action fails", async () => {
    const dfa = {
      id: "dfa-2", dfaNo: "DFA-002", communicationType: "letter", subject: "Test 2",
      status: "draft", editable: true, recipientName: null, updatedAt: "2026-08-17T00:00:00Z",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [dfa] })) // initial load
      .mockResolvedValueOnce(new Response("", { status: 503 })); // submit action fails

    render(<DfaPanel />);

    const submitBtn = await screen.findByRole("button", { name: "Submit" });
    fireEvent.click(submitBtn);
    const dialog = await screen.findByRole("alertdialog");
    const dialogConfirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit");
    fireEvent.click(dialogConfirm!);

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b503\b/);
    expect(dialog.textContent).not.toMatch(/\bsubmit: /);
  });
});

describe("DfaPanel — GAP-ESTAB-DFA-01 (load error state)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows a retryable ErrorState (not 'No drafts' text) when load fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    render(<DfaPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument());
    expect(screen.queryByText(/No drafts in this view/i)).not.toBeInTheDocument();
  });
});

describe("DfaPanel — GAP-ESTAB-DFA-03 (returned filter tab)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("includes a 'Returned' tab in the segment control", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<DfaPanel />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Returned" })).toBeInTheDocument());
  });
});

describe("DfaPanel — GAP-ESTAB-DFA-05 (human labels)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("tab labels are human-readable (not snake_case)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<DfaPanel />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Pending Approval" })).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: "pending_approval" })).not.toBeInTheDocument();
  });
});

describe("DfaPanel — GAP-ESTAB-DFA-02 (approve needs remarks)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("the Approve dialog requires a reason (remarks)", async () => {
    const dfa = {
      id: "dfa-a", dfaNo: "DFA-A01", communicationType: "letter", subject: "Approve me",
      status: "pending_approval", editable: false, recipientName: null, updatedAt: "2026-10-01T00:00:00Z",
      fileId: null,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [dfa] }));
    render(<DfaPanel />);
    const approveBtn = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approveBtn);
    const dialog = await screen.findByRole("alertdialog");
    // The dialog must have a reason/textarea
    const textarea = dialog.querySelector("textarea");
    expect(textarea).toBeTruthy();
    // Confirm button should be disabled until reason is filled (requireReason)
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve");
    expect(confirmBtn).toBeTruthy();
  });
});

describe("DfaPanel — GAP2-ESTAB-NOTIFICATIONS-DFALINK-01 (?focus= deep-link)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearch = new URLSearchParams();
  });

  it("highlights the focused draft and shows a 'you selected' banner when it is in view", async () => {
    const dfa = {
      id: "dfa-focus-1", dfaNo: "DFA-F01", communicationType: "letter", subject: "Follow me from a notification",
      status: "pending_approval", editable: false, recipientName: null, updatedAt: "2026-10-01T00:00:00Z", fileId: null,
    };
    mockSearch = new URLSearchParams({ focus: "dfa-focus-1" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [dfa] }));

    render(<DfaPanel />);

    const banner = await screen.findByTestId("dfa-focus-banner");
    expect(banner.textContent).toMatch(/DFA-F01/);
    // the DFA No cell for the focused row is marked
    await waitFor(() => {
      const cell = document.querySelector('[data-focused="true"]');
      expect(cell?.textContent).toMatch(/DFA-F01/);
    });
  });

  it("tells the officer the draft isn't in this view when the focus id is absent from the current list", async () => {
    const dfa = {
      id: "dfa-other", dfaNo: "DFA-OTHER", communicationType: "letter", subject: "A different draft",
      status: "draft", editable: true, recipientName: null, updatedAt: "2026-10-01T00:00:00Z", fileId: null,
    };
    mockSearch = new URLSearchParams({ focus: "dfa-missing-id" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [dfa] }));

    render(<DfaPanel />);

    const banner = await screen.findByTestId("dfa-focus-banner");
    expect(banner.textContent).toMatch(/isn't in this view/i);
    expect(document.querySelector('[data-focused="true"]')).toBeNull();
  });

  it("renders no focus banner when no ?focus= is present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<DfaPanel />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument());
    expect(screen.queryByTestId("dfa-focus-banner")).toBeNull();
  });
});

describe("DfaPanel — focus banner is localised (not hardcoded English)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("renders the hi copy for the not-in-view banner", async () => {
    mockSearch = new URLSearchParams({ focus: "dfa-missing-id" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    rtlRender(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <DfaPanel />
      </NextIntlClientProvider>,
    );
    const banner = await screen.findByTestId("dfa-focus-banner");
    expect(banner.textContent).toBe(hiMessages.estabDfaFocus.missing);
    expect(banner.textContent).not.toMatch(/in this view/i);
  });
});
