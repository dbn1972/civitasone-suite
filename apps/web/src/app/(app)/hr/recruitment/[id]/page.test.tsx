import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

type FetchMock = ReturnType<typeof vi.fn> & {
  lastScreeningBody?: Record<string, unknown>;
  lastWithdrawBody?: Record<string, unknown>;
  lastPublishBody?: Record<string, unknown>;
  lastInterviewBody?: Record<string, unknown>;
  lastOfferBody?: Record<string, unknown>;
};

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

  it("shows refNo in the header and the real vacancy type (GAP-RECRUITMENT-DETAIL-01)", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) {
        return new Response(JSON.stringify({ data: [{ ...OPENING, refNo: "HUD/2026/014", vacancyType: "internship", department: "Housing & Urban Development" }] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/applications$/)) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);
    renderPage();
    expect(await screen.findByText("HUD/2026/014 · Housing & Urban Development")).toBeInTheDocument();
    expect(screen.getByText("Internship")).toBeInTheDocument();
    expect(screen.queryByText("Regular")).not.toBeInTheDocument();
  });

  it("does not print a dangling separator or default the type to Regular when the fields are absent", async () => {
    const { refNo: _drop, ...noRef } = OPENING as typeof OPENING & { refNo?: string };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [noRef] }), { status: 200 });
      if (url.match(/job-openings\/[^/]+\/applications$/)) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    }));
    renderPage();
    await screen.findByText("Junior Engineer");
    expect(screen.queryByText(/^\s*·/)).not.toBeInTheDocument();
    expect(screen.queryByText("Regular")).not.toBeInTheDocument();
  });

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
    const dialog = await screen.findByRole("alertdialog");
    // GAP-RECRUITMENT-DETAIL-04: confirm stays disabled until a reason code is picked.
    const confirmBtn = within(dialog).getByRole("button", { name: /reject application/i });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason for rejection/i), { target: { value: "incomplete_documents" } });
    fireEvent.change(within(dialog).getByLabelText(/remarks/i), { target: { value: "No degree certificate attached" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect((fetchMock as FetchMock).lastScreeningBody).toBeTruthy());
    const body = (fetchMock as FetchMock).lastScreeningBody;
    const VALID_REASON_CODES = ["eligibility", "skill", "experience", "qualification", "incomplete_documents", "duplicate", "position_hold", "other"];
    expect(VALID_REASON_CODES).toContain(body?.reasonCode);
    expect(body).toMatchObject({ decision: "ineligible", reasonCode: "incomplete_documents", remarks: "No degree certificate attached" });
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
      fireEvent.change(within(dialog).getByLabelText(/reason for rejection/i), { target: { value: "skill" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /reject application/i }));

      await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
      expect(dialog.textContent).not.toMatch(/hrms-service/);
      expect(dialog.textContent).not.toMatch(/\b500\b/);
    });
  });

  // GAP-RECRUITMENT-DETAIL-09: "Shortlist All Pending" is confirm-gated and uses ONE batch call (not n parallel
  // per-row POSTs whose failures were swallowed).
  describe("Shortlist All Pending (GAP-RECRUITMENT-DETAIL-09)", () => {
    function mockBulk(bulkRes: () => Response | Promise<Response>) {
      const fn = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
        if (url.match(/job-openings\/[^/]+\/applications$/)) return new Response(JSON.stringify({ data: [APPLIED_APP, APPLIED_APP2] }), { status: 200 });
        if (url.match(/job-openings\/[^/]+\/shortlist$/)) {
          (fn as unknown as { lastBulkBody?: unknown }).lastBulkBody = JSON.parse(String(init?.body ?? "{}"));
          return bulkRes();
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });
      vi.stubGlobal("fetch", fn);
      return fn;
    }
    const bulkCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(([u]) => /\/shortlist$/.test(String(u)));

    it("asks for confirmation first; cancelling sends nothing", async () => {
      const fn = mockBulk(() => new Response("{}", { status: 200 }));
      renderPage();
      await screen.findByText("Priya Nair");
      fireEvent.click(screen.getByRole("button", { name: /Shortlist All Pending/i }));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(/shortlist 2 pending applicants/i);
      fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(bulkCalls(fn)).toHaveLength(0);
      expect(fn.mock.calls.some(([u]) => String(u).includes("/screening-decision"))).toBe(false);
    });

    it("sends exactly one POST with every pending id and reports shortlisted / skipped", async () => {
      const fn = mockBulk(() => new Response(JSON.stringify({ shortlisted: 1, skipped: 1, requested: 2 }), { status: 200 }));
      renderPage();
      await screen.findByText("Priya Nair");
      fireEvent.click(screen.getByRole("button", { name: /Shortlist All Pending/i }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /^Shortlist 2$/ }));

      expect(await screen.findByText(/Shortlisted 1, skipped 1 .* of 2 requested/i)).toBeInTheDocument();
      expect(bulkCalls(fn)).toHaveLength(1);
      expect(((fn as unknown as { lastBulkBody: { applicationIds: string[] } }).lastBulkBody).applicationIds.sort()).toEqual(["app-1", "app-3"]);
      // The list is re-read from the server afterwards instead of being optimistically rewritten.
      await waitFor(() => expect(fn.mock.calls.filter(([u]) => /job-openings\/[^/]+\/applications$/.test(String(u))).length).toBeGreaterThan(1));
    });

    it("shows a visible error and re-enables the button when the batch call fails", async () => {
      mockBulk(() => new Response("hrms-service: boom", { status: 500 }));
      renderPage();
      await screen.findByText("Priya Nair");
      const trigger = screen.getByRole("button", { name: /Shortlist All Pending/i });
      fireEvent.click(trigger);
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /^Shortlist 2$/ }));
      await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
      expect(dialog.textContent).not.toMatch(/hrms-service|\b500\b/);
      fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
      await waitFor(() => expect(trigger).not.toBeDisabled());
    });
  });

  // GAP-RECRUITMENT-DETAIL-11: a failed applications fetch must not read as "0 received".
  it("shows no pipeline counts or '0 / 0' when the applications fetch fails, only the error with Retry", async () => {
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return fail ? new Response("", { status: 500 }) : new Response(JSON.stringify({ data: [APPLIED_APP, APPLIED_APP2] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }));
    renderPage();
    await screen.findByRole("button", { name: /retry|try again/i });
    expect(screen.queryByText("Application Pipeline")).not.toBeInTheDocument();
    expect(screen.queryByText("0 / 0")).not.toBeInTheDocument();
    // Applications tile shows an em dash, not 0.
    const tile = screen.getByText("Applications", { selector: "p" }).previousElementSibling as HTMLElement;
    expect(tile.textContent).toBe("—");

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByText("Application Pipeline")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  // GAP-RECRUITMENT-DETAIL-07 / -12: status words are humanised and dates share the IST dd Mon yyyy format.
  it("renders humanised status pills and IST dates instead of raw enums and numeric locale dates", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) {
        return new Response(JSON.stringify({ data: [{ ...OPENING, status: "on_hold", applicationDeadline: "2026-09-30" }] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return new Response(JSON.stringify({ data: [{ ...APPLIED_APP, stage: "shortlisted", screeningDecision: "manual_review", appliedAt: "2026-09-30T18:45:00Z" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }));
    const { container } = renderPage();
    await screen.findByText("Asha Verma");
    const pills = [...container.querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pills).toEqual(expect.arrayContaining(["On Hold", "Shortlisted", "Manual Review"]));
    expect(container.textContent).not.toMatch(/manual_review|on_hold/);
    // Date-only deadline is not timezone-shifted; the 18:45Z applied-at rolls over to 1 Oct in IST.
    expect(screen.getByText(/^30 Sep(t)? 2026$/)).toBeInTheDocument();
    expect(screen.getByText(/^0?1 Oct 2026$/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  // GAP-RECRUITMENT-DETAIL-02: no "Interview" column nothing can fill; a scheduled interview shows on the row.
  it("has no never-populated Interview column and shows the scheduled slot on the row", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return new Response(JSON.stringify({ data: [{ ...APPLIED_APP, stage: "shortlisted", screeningDecision: "shortlisted" }] }), { status: 200 });
      }
      if (url.includes("/hrms/interviews?")) {
        return new Response(JSON.stringify({ data: [
          { id: "i1", applicationId: "app-1", scheduledDate: "2026-10-05", scheduledTime: "09:30", status: "scheduled" },
          { id: "i2", applicationId: "app-1", scheduledDate: "2026-10-01", scheduledTime: "09:30", status: "cancelled" },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }));
    renderPage();
    await screen.findByText("Asha Verma");
    expect(screen.queryByRole("button", { name: /Interview: \d+ applications/ })).not.toBeInTheDocument();
    expect(await screen.findByText(/Interview scheduled · 0?5 Oct 2026, 03:00 pm/i)).toBeInTheDocument();
    expect(screen.queryByText(/0?1 Oct 2026, 03:00/)).not.toBeInTheDocument();
  });
});

describe("JobOpeningDetailPage — advertisement & corrigenda (GAP-RECRUITMENT-DETAIL-13)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is collapsed by default (no extra requests) and loads the advertisement panel on expand, read-only when the vacancy is published", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      if (url.endsWith("/advertisement")) {
        return new Response(JSON.stringify({ id: "job-1", status: "open", applicationDeadline: null, feesMinor: "50000", feeExemption: null, requiredDocuments: [], selectionProcess: null, importantDates: {}, portalScope: "public" }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    renderPage();
    const toggle = await screen.findByRole("button", { name: /advertisement & corrigenda/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(fn.mock.calls.some(([u]) => String(u).endsWith("/advertisement"))).toBe(false);
    fireEvent.click(toggle);
    expect(await screen.findByLabelText(/Application fee/)).toHaveValue("500.00");
    expect(screen.getByLabelText(/Application fee/)).toBeDisabled(); // OPENING is published
  });
});

// CRITICAL fix (Bug 1): the job-opening publish control. Previously no UI
// path could ever flip is_published, so the detail page's badge always read
// "Not published" regardless of the real DB value. These tests cover the
// toggle's happy path in both directions plus its failure path -- none of
// this had any automated coverage before this fix.
describe("JobOpeningDetailPage — publish control (Bug 1)", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  /** `readBack` is what the (cached) opening list returns for isPublished on each successive GET. */
  function mockPublishSequence(readBack: boolean[], publishStatus = 202, opening: Partial<typeof OPENING> & Record<string, unknown> = {}) {
    let reads = 0;
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("job-openings?limit=")) {
        const isPublished = readBack[Math.min(reads, readBack.length - 1)];
        reads += 1;
        return new Response(JSON.stringify({ data: [{ ...OPENING, ...opening, isPublished }] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/publish$/)) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        (fn as FetchMock).lastPublishBody = body;
        return new Response(JSON.stringify({}), { status: publishStatus });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const publishCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(([u]) => /\/publish$/.test(String(u)));

  it("asks for confirmation before publishing and sends nothing until confirmed (GAP-RECRUITMENT-DETAIL-10)", async () => {
    const fn = mockPublishSequence([false]);
    renderPage();
    await screen.findByText("Not published");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/visible to the public/i);
    expect(publishCalls(fn)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(publishCalls(fn)).toHaveLength(0);
  });

  it("publishing calls PATCH .../publish with isPublished: true, shows 'Publishing…' until a read-back confirms it", async () => {
    // First read (page load) = false, next read (poll) still false (stale cache), then true.
    const fetchMock = mockPublishSequence([false, false, true]);
    renderPage();
    await screen.findByText("Not published");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish vacancy" }));

    await waitFor(() => expect((fetchMock as FetchMock).lastPublishBody).toEqual({ isPublished: true }));
    // 202 accepted: not yet reflected, so the badge must NOT flip optimistically.
    expect(await screen.findByRole("status")).toHaveTextContent(/publishing/i);
    expect(screen.getByText("Not published")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText("Not published")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    await screen.findByText("Published");
    await screen.findByRole("button", { name: "Unpublish" });
  });

  it("tells the officer it is still processing when the change never shows up", async () => {
    mockPublishSequence([false]);
    renderPage();
    await screen.findByText("Not published");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publish vacancy" }));
    await screen.findByRole("status");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/still processing/i);
    expect(screen.getByText("Not published")).toBeInTheDocument();
  });

  it("requires confirmation to unpublish and sends isPublished: false", async () => {
    const fetchMock = mockPublishSequence([true, false]);
    renderPage();
    await screen.findByText("Published");
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/no longer be able to apply/i);
    expect(publishCalls(fetchMock)).toHaveLength(0);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unpublish vacancy" }));
    await waitFor(() => expect((fetchMock as FetchMock).lastPublishBody).toEqual({ isPublished: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    await screen.findByText("Not published");
    await screen.findByRole("button", { name: "Publish" });
  });

  it("shows a clerk-safe error in the dialog and leaves the badge unchanged when the publish request fails", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) {
        return new Response(JSON.stringify({ data: [{ ...OPENING, isPublished: false }] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/publish$/)) {
        return new Response("hrms-service: publish trace", { status: 500 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fn);

    renderPage();
    await screen.findByText("Not published");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish vacancy" }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/hrms-service/);
    expect(dialog.textContent).not.toMatch(/\b500\b/);
    expect(screen.getByText("Not published")).toBeInTheDocument();
  });

  it("disables Publish with an explanation for a closed vacancy or one past its deadline, but never blocks Unpublish", async () => {
    mockPublishSequence([false], 202, { status: "closed" });
    const { unmount } = renderPage();
    await screen.findByText("Not published");
    const btn = screen.getByRole("button", { name: "Publish" });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/only an open vacancy can be published/i)).toBeInTheDocument();
    unmount();

    mockPublishSequence([false], 202, { applicationDeadline: "2020-01-01" });
    const second = renderPage();
    await screen.findByText("Not published");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText(/deadline has passed/i)).toBeInTheDocument();
    second.unmount();

    mockPublishSequence([true], 202, { status: "closed", applicationDeadline: "2020-01-01" });
    renderPage();
    await screen.findByText("Published");
    expect(screen.getByRole("button", { name: "Unpublish" })).not.toBeDisabled();
  });
});

// CRITICAL fix (Bug 2): the previously-disabled "Schedule Interview" action
// on a shortlisted application. Wires the already-built, already-hardened
// POST /v1/hrms/interviews -- had no caller anywhere in the UI before this
// fix, and no test coverage of the wiring itself.
describe("JobOpeningDetailPage — schedule interview (Bug 2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const SHORTLISTED_APP = {
    id: "app-4",
    applicantName: "Kiran Rao",
    email: "kiran@example.com",
    stage: "shortlisted",
    screeningDecision: "shortlisted",
  };

  function mockShortlistedSequence(interviewStatus = 202) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("job-openings?limit=")) {
        return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return new Response(JSON.stringify({ data: [SHORTLISTED_APP] }), { status: 200 });
      }
      if (url.includes("/hrms/employees")) {
        // EntityPicker search (?q=) and the post-submit name lookup (?ids=).
        return new Response(JSON.stringify({ data: [
          { id: "11111111-1111-4111-8111-111111111111", employeeNo: "E-101", name: "Sunita Rao", department: "IT" },
          { id: "22222222-2222-4222-8222-222222222222", employeeNo: "E-102", name: "Vikram Shah", department: "HR" },
        ] }), { status: 200 });
      }
      if (init?.method === "POST" && url.includes("/hrms/interviews")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        (fn as FetchMock).lastInterviewBody = body;
        return new Response(JSON.stringify({}), { status: interviewStatus });
      }
      if (url.includes("/hrms/interviews")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  async function openScheduleInterviewDialog() {
    await screen.findByText("Kiran Rao");
    const row = screen.getByText("Kiran Rao").closest("div.px-5") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /application actions/i }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "Schedule Interview" }));
    return screen.findByRole("dialog");
  }

  it("posts to /v1/hrms/interviews with the job opening and application ids plus the entered interviewer and time, and shows the scheduled confirmation", async () => {
    const fetchMock = mockShortlistedSequence();
    renderPage();
    const dialog = await openScheduleInterviewDialog();

    // GAP-RECRUITMENT-DETAIL-06: pick interviewers by name, never type UUIDs.
    const picker = within(dialog).getByLabelText(/interviewer/i);
    fireEvent.change(picker, { target: { value: "sunita" } });
    fireEvent.mouseDown(await within(dialog).findByText("Sunita Rao (E-101)"));
    fireEvent.change(picker, { target: { value: "vikram" } });
    fireEvent.mouseDown(await within(dialog).findByText("Vikram Shah (E-102)"));
    fireEvent.change(within(dialog).getByLabelText(/date & time/i), { target: { value: "2027-01-15T10:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Schedule Interview" }));

    await waitFor(() => expect((fetchMock as FetchMock).lastInterviewBody).toBeTruthy());
    const body = (fetchMock as FetchMock).lastInterviewBody as Record<string, unknown>;
    expect(body.jobOpeningId).toBe("job-1");
    expect(body.applicationId).toBe("app-4");
    expect(body.interviewerIds).toEqual(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]);
    expect(Number.isNaN(new Date(body.scheduledAt as string).getTime())).toBe(false);

    expect(await within(dialog).findByText("Interview scheduled.")).toBeInTheDocument();
    // The confirmation card shows names, not UUIDs.
    expect(dialog.textContent).toContain("Sunita Rao (E-101), Vikram Shah (E-102)");
    expect(dialog.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("does not submit, and shows a required-fields message, when no interviewer or date has been entered", async () => {
    const fetchMock = mockShortlistedSequence();
    renderPage();
    const dialog = await openScheduleInterviewDialog();

    // Leave interviewer/date blank: the component's own guard
    // (no interviewer selected || !scheduledAt) is what is under test here.
    fireEvent.submit(within(dialog).getByRole("button", { name: "Schedule Interview" }).closest("form") as HTMLFormElement);

    expect(await within(dialog).findByText(/please provide at least one interviewer/i)).toBeInTheDocument();
    expect((fetchMock as FetchMock).lastInterviewBody).toBeUndefined();
  });
});

// GAP-RECRUITMENT-DETAIL-05: "Send Offer" opens the approval-workflow dialog. The old single-field PATCH
// .../offer skipped maker-checker approval, so the page must never call it.
describe("JobOpeningDetailPage — offer approval workflow (DETAIL-05)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const SHORTLISTED_APP = {
    id: "app-5",
    applicantName: "Meera Iyer",
    email: "m***@e***.com",
    contactMasked: true,
    stage: "shortlisted",
    screeningDecision: "shortlisted",
  };

  function mockShortlistedSequence(app: Record<string, unknown> = SHORTLISTED_APP) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      if (url.match(/job-openings\/[^/]+\/applications$/)) return new Response(JSON.stringify({ data: [app] }), { status: 200 });
      if (url.match(/applications\/[^/]+\/offers$/) && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (url.match(/applications\/[^/]+\/offers$/) && init?.method === "POST") {
        (fn as FetchMock).lastOfferBody = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ id: "o-1", status: "draft" }), { status: 201 });
      }
      if (url.match(/applications\/[^/]+\/offer$/)) {
        (fn as FetchMock).lastOfferBody = { legacyPatchCalled: true };
        return new Response(JSON.stringify({}), { status: 202 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  async function openOfferDialog(menuItem = "Send Offer") {
    await screen.findByText("Meera Iyer");
    const row = screen.getByText("Meera Iyer").closest("div.px-5") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /application actions/i }));
    fireEvent.click(within(row).getByRole("menuitem", { name: menuItem }));
    return { dialog: await screen.findByRole("dialog"), row };
  }

  it("creates a DRAFT offer through POST .../offers with basic pay in exact paise, pay level and cell -- never the PATCH shortcut", async () => {
    const fetchMock = mockShortlistedSequence();
    renderPage();
    const { dialog } = await openOfferDialog();
    fireEvent.change(await within(dialog).findByLabelText(/pay level/i), { target: { value: "10" } });
    fireEvent.change(within(dialog).getByLabelText(/^cell/i), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText(/basic pay/i), { target: { value: "56100.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create draft offer" }));
    await waitFor(() => expect((fetchMock as FetchMock).lastOfferBody).toBeTruthy());
    expect((fetchMock as FetchMock).lastOfferBody).toEqual({ basicMinor: 5610050, payLevel: 10, payCell: 3 });
    expect(await within(dialog).findByText("Draft offer created.")).toBeInTheDocument();
  });

  it("rejects a sub-paise basic pay and sends nothing", async () => {
    const fetchMock = mockShortlistedSequence();
    renderPage();
    const { dialog } = await openOfferDialog();
    fireEvent.change(await within(dialog).findByLabelText(/basic pay/i), { target: { value: "1.005" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Create draft offer" }).closest("form") as HTMLFormElement);
    expect(await within(dialog).findByText(/basic pay greater than zero/i)).toBeInTheDocument();
    expect((fetchMock as FetchMock).lastOfferBody).toBeUndefined();
  });

  it("an application already 'offered' offers Manage offer, not a second Send Offer", async () => {
    mockShortlistedSequence({ ...SHORTLISTED_APP, stage: "offered" });
    renderPage();
    await screen.findByText("Meera Iyer");
    const row = screen.getByText("Meera Iyer").closest("div.px-5") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /application actions/i }));
    expect(within(row).getByRole("menuitem", { name: "Manage offer" })).toBeInTheDocument();
    expect(within(row).queryByRole("menuitem", { name: "Send Offer" })).not.toBeInTheDocument();
  });
});

describe("JobOpeningDetailPage — applicant privacy and sub-pages (DETAIL-08 / -13 / -14)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const MASKED_APP = {
    id: "app-7", applicationNo: "APP-2026-000007", applicantName: "Asha Verma", email: "a***@e***.com", mobile: "******3210",
    contactMasked: true, category: "sc", hasResume: true, qualification: "B.Com", stage: "applied", screeningDecision: "pending",
  };

  function mockMasked() {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      if (url.match(/job-openings\/[^/]+\/applications$/)) return new Response(JSON.stringify({ data: [MASKED_APP] }), { status: 200 });
      if (url.match(/job-openings\/[^/]+\/blind-list$/)) {
        // the service withholds name / contact / category / resume entirely
        return new Response(JSON.stringify({ data: [{ id: "app-7", applicationNo: "APP-2026-000007", qualification: "B.Com", stage: "applied", screeningDecision: "pending" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("renders the service-masked contact details with a Reveal control (the raw address is never in the page)", async () => {
    mockMasked();
    renderPage();
    await screen.findByText("Asha Verma");
    expect(screen.getByTestId("contact-app-7")).toHaveTextContent("a***@e***.com · ******3210");
    expect(screen.getByRole("button", { name: /reveal contact details for asha verma/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("asha@example.com");
  });

  it("shows the self-declared category as unverified, and a resume link", async () => {
    mockMasked();
    renderPage();
    expect(await screen.findByText(/category: SC \(self-declared, not yet verified\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View resume" })).toBeInTheDocument();
  });

  it("blind screening loads the redacted list: no name or contact in the payload, the application number stands in", async () => {
    const fn = mockMasked();
    renderPage();
    await screen.findByText("Asha Verma");
    fireEvent.click(screen.getByRole("switch", { name: /blind screening: off/i }));
    expect(await screen.findByText("APP-2026-000007")).toBeInTheDocument();
    expect(screen.queryByText("Asha Verma")).not.toBeInTheDocument();
    expect(screen.queryByTestId("contact-app-7")).not.toBeInTheDocument();
    expect(fn.mock.calls.some(([u]) => String(u).endsWith("/job-openings/job-1/blind-list"))).toBe(true);
    expect(screen.getByRole("switch", { name: /blind screening: on/i })).toHaveAttribute("aria-checked", "true");
  });

  it("searching no longer matches the (masked) email", async () => {
    mockMasked();
    renderPage();
    await screen.findByText("Asha Verma");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "a***@e***" } });
    expect(await screen.findByText(/no applications match/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "APP-2026-000007" } });
    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
  });

  it("links to the selection lists and the results / admit cards sub-pages", async () => {
    mockMasked();
    renderPage();
    expect(await screen.findByRole("link", { name: "Selection lists" })).toHaveAttribute("href", "/hr/recruitment/job-1/selection");
    expect(screen.getByRole("link", { name: "Results and admit cards" })).toHaveAttribute("href", "/hr/recruitment/job-1/results");
  });
});
