import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

type FetchMock = ReturnType<typeof vi.fn> & { lastScreeningBody?: Record<string, unknown>; lastWithdrawBody?: Record<string, unknown> };

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "job-1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import JobOpeningDetailPage from "./page";

// UX-017: JobOpeningDetailPage (and its ContextMenu) now read their copy
// through next-intl (useTranslations("recruitmentDetail")), so they need a
// real provider in the tree -- same pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <JobOpeningDetailPage />
    </NextIntlClientProvider>,
  );
}

const OPENING = {
  id: "job-1",
  refNo: "JOB-2026-0001",
  jobTitle: "Junior Engineer",
  department: "IT",
  vacancies: 2,
  status: "open",
  isPublished: true,
};

const APPLIED_APP = {
  id: "app-1",
  applicantName: "Asha Verma",
  email: "asha@example.com",
  stage: "applied",
  screeningDecision: "pending",
};

const SELECTED_APP = {
  id: "app-2",
  applicantName: "Rahul Singh",
  email: "rahul@example.com",
  stage: "selected",
  screeningDecision: "eligible",
};

const APPLIED_APP2 = {
  id: "app-3",
  applicantName: "Priya Nair",
  email: "priya@example.com",
  stage: "applied",
  screeningDecision: "pending",
};

function mockFetchSequence(applications = [APPLIED_APP]) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("job-openings?limit=")) {
      return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
    }
    if (url.match(/job-openings\/[^/]+\/applications$/)) {
      return new Response(JSON.stringify({ data: applications }), { status: 200 });
    }
    if (url.includes("/screening-decision")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      (fn as FetchMock).lastScreeningBody = body;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (url.endsWith("/withdraw")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      (fn as FetchMock).lastWithdrawBody = body;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (url.endsWith("/stage")) {
      // The dead route the page used to call — must never be hit again.
      return new Response(JSON.stringify({ message: "Route not found" }), { status: 404 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function openActionsMenu(rowName: RegExp) {
  const row = screen.getByText(rowName).closest("div.px-5") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: /application actions/i }));
  return row;
}

describe("JobOpeningDetailPage — applications pipeline", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("links the applicant's name to the application detail page (the only route the Hire flow is reachable from)", async () => {
    mockFetchSequence([SELECTED_APP]);
    renderPage();
    const link = await screen.findByRole("link", { name: "Rahul Singh" });
    expect(link).toHaveAttribute("href", "/hr/recruitment/job-1/applications/app-2");
  });

  it("requires confirmation before rejecting an application (no bare one-click reject)", async () => {
    mockFetchSequence([APPLIED_APP]);
    renderPage();
    await screen.findByText("Asha Verma");
    const row = await openActionsMenu(/Asha Verma/);
    fireEvent.click(within(row).getByRole("menuitem", { name: "Reject" }));

    // Confirmation dialog must appear; the network call must NOT have fired yet.
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/reject this application/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("screening-decision"), expect.anything());
  });

  it("sends a valid reasonCode on reject (backend enum is eligibility|skill|experience|qualification|incomplete_documents|duplicate|position_hold|other)", async () => {
    const fetchMock = mockFetchSequence([APPLIED_APP]);
    renderPage();
    await screen.findByText("Asha Verma");
    const row = await openActionsMenu(/Asha Verma/);
    fireEvent.click(within(row).getByRole("menuitem", { name: "Reject" }));
    fireEvent.click(await screen.findByRole("button", { name: /reject application/i }));

    await waitFor(() => expect((fetchMock as FetchMock).lastScreeningBody).toBeTruthy());
    const body = (fetchMock as FetchMock).lastScreeningBody;
    const VALID_REASON_CODES = ["eligibility", "skill", "experience", "qualification", "incomplete_documents", "duplicate", "position_hold", "other"];
    expect(VALID_REASON_CODES).toContain(body?.reasonCode);
  });

  it("withdraw calls the real /withdraw endpoint with a required reason, not the nonexistent /stage endpoint", async () => {
    const fetchMock = mockFetchSequence([SELECTED_APP]);
    renderPage();
    await screen.findByText("Rahul Singh");
    const row = await openActionsMenu(/Rahul Singh/);
    fireEvent.click(within(row).getByRole("menuitem", { name: "Withdraw" }));

    const dialog = await screen.findByRole("alertdialog");
    // Reason is required — confirm must start disabled.
    const confirmBtn = within(dialog).getByRole("button", { name: /withdraw application/i });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Candidate accepted another offer" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect((fetchMock as FetchMock).lastWithdrawBody).toBeTruthy());
    expect((fetchMock as FetchMock).lastWithdrawBody).toEqual({ reason: "Candidate accepted another offer" });
    // Never call the dead route.
    const calledUrls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calledUrls.some((u: string) => u.endsWith("/stage"))).toBe(false);
  });

  it("shows a truthful failure hint when an action's request fails, instead of silently marking it done", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      if (url.match(/applications$/)) return new Response(JSON.stringify({ data: [APPLIED_APP] }), { status: 200 });
      if (url.includes("/screening-decision")) return new Response(JSON.stringify({}), { status: 500 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);

    renderPage();
    await screen.findByText("Asha Verma");
    const row = await openActionsMenu(/Asha Verma/);
    fireEvent.click(within(row).getByRole("menuitem", { name: "Shortlist" }));

    await waitFor(() => {
      expect(within(row).getByText(/action failed/i)).toBeInTheDocument();
    });
  });

  /**
   * UX-016: loading the vacancy used to show `Failed to load vacancy
   * (${res.status})`, and a confirm-gated action (reject/withdraw) used to
   * show `Action failed (HTTP ${res.status})` verbatim inside the confirm
   * dialog — the same class of leak useFormError closes fleet-wide
   * (UX-003).
   */
  describe("UX-016 clerk-safe errors", () => {
    it("shows a clerk-safe message, never the raw HTTP status, when the vacancy fails to load", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("job-openings?limit=")) return new Response("", { status: 500 });
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }),
      );
      renderPage();

      await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeInTheDocument());
      expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
    });

    it("shows a clerk-safe message, never the raw HTTP status, in the confirm dialog when reject fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
          if (url.match(/applications$/)) return new Response(JSON.stringify({ data: [APPLIED_APP] }), { status: 200 });
          if (url.includes("/screening-decision")) return new Response("hrms-service: screening-decision trace", { status: 500 });
          return new Response(JSON.stringify({}), { status: 404 });
        }),
      );

      renderPage();
      await screen.findByText("Asha Verma");
      const row = await openActionsMenu(/Asha Verma/);
      fireEvent.click(within(row).getByRole("menuitem", { name: "Reject" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /reject application/i }));

      await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
      expect(dialog.textContent).not.toMatch(/hrms-service/);
      expect(dialog.textContent).not.toMatch(/\b500\b/);
    });
  });

  // The bulk "Shortlist All Pending" quick action had no busy-state guard:
  // nothing stopped a second click from firing a second overlapping
  // Promise.all(...) batch of the same per-application POSTs while the
  // first batch was still in flight.
  it("guards the 'Shortlist All Pending' bulk action against firing a second overlapping batch while the first is still in flight", async () => {
    const gate: { release?: () => void } = {};
    const screeningGate = new Promise<void>((resolve) => { gate.release = resolve; });
    const fn = vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return new Response(JSON.stringify({ data: [APPLIED_APP, APPLIED_APP2] }), { status: 200 });
      }
      if (url.includes("/screening-decision")) {
        await screeningGate; // held open until the test releases it below
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);

    renderPage();
    await screen.findByText("Asha Verma");
    await screen.findByText("Priya Nair");

    const bulkBtn = screen.getByRole("button", { name: /Shortlist All Pending/i });
    fireEvent.click(bulkBtn);

    // Still in flight (gated): the trigger must now be disabled, and two
    // more clicks while it's held there must not queue further batches.
    expect(bulkBtn).toBeDisabled();
    fireEvent.click(bulkBtn);
    fireEvent.click(bulkBtn);

    gate.release?.();
    await waitFor(() => expect(bulkBtn).not.toBeDisabled());

    const screeningCalls = fn.mock.calls.filter(([u]) => String(u).includes("/screening-decision"));
    // Exactly one call per pending application (2) -- not doubled/tripled
    // by the extra clicks fired while the first batch was in flight.
    expect(screeningCalls.length).toBe(2);
  });
});
