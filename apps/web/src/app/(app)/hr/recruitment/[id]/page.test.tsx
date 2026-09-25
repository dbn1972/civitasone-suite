import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

// CRITICAL fix (Bug 1): the job-opening publish control. Previously no UI
// path could ever flip is_published, so the detail page's badge always read
// "Not published" regardless of the real DB value. These tests cover the
// toggle's happy path in both directions plus its failure path -- none of
// this had any automated coverage before this fix.
describe("JobOpeningDetailPage — publish control (Bug 1)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockPublishSequence(isPublished: boolean, publishStatus = 202) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("job-openings?limit=")) {
        return new Response(JSON.stringify({ data: [{ ...OPENING, isPublished }] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/publish$/)) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        (fn as FetchMock).lastPublishBody = body;
        return new Response(JSON.stringify({}), { status: publishStatus });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("shows 'Not published' and a 'Publish' button for an unpublished opening, and publishing it calls PATCH .../publish with isPublished: true", async () => {
    const fetchMock = mockPublishSequence(false);
    renderPage();

    await screen.findByText("Not published");
    const publishBtn = screen.getByRole("button", { name: "Publish" });
    fireEvent.click(publishBtn);

    await waitFor(() => expect((fetchMock as FetchMock).lastPublishBody).toBeTruthy());
    expect((fetchMock as FetchMock).lastPublishBody).toEqual({ isPublished: true });

    // Optimistic update: badge and button both flip once the request succeeds.
    await screen.findByText("Published");
    await screen.findByRole("button", { name: "Unpublish" });
  });

  it("shows 'Published' and an 'Unpublish' button for a published opening, and unpublishing it calls PATCH .../publish with isPublished: false", async () => {
    const fetchMock = mockPublishSequence(true);
    renderPage();

    await screen.findByText("Published");
    const unpublishBtn = screen.getByRole("button", { name: "Unpublish" });
    fireEvent.click(unpublishBtn);

    await waitFor(() => expect((fetchMock as FetchMock).lastPublishBody).toBeTruthy());
    expect((fetchMock as FetchMock).lastPublishBody).toEqual({ isPublished: false });

    await screen.findByText("Not published");
    await screen.findByRole("button", { name: "Publish" });
  });

  it("shows a clerk-safe error and leaves the badge unchanged when the publish request fails", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("job-openings?limit=")) {
        return new Response(JSON.stringify({ data: [{ ...OPENING, isPublished: false }] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/publish$/)) {
        return new Response("hrms-service: publish trace", { status: 500 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);

    renderPage();
    await screen.findByText("Not published");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/hrms-service/);
    expect(alert.textContent).not.toMatch(/\b500\b/);

    // Still not published -- a failed request must not optimistically flip the UI.
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
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
      if (url.endsWith("/v1/hrms/interviews") || url.includes("/hrms/interviews")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        (fn as FetchMock).lastInterviewBody = body;
        return new Response(JSON.stringify({}), { status: interviewStatus });
      }
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

    fireEvent.change(within(dialog).getByLabelText(/interviewer id/i), { target: { value: "interviewer-1" } });
    fireEvent.change(within(dialog).getByLabelText(/date & time/i), { target: { value: "2027-01-15T10:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Schedule Interview" }));

    await waitFor(() => expect((fetchMock as FetchMock).lastInterviewBody).toBeTruthy());
    const body = (fetchMock as FetchMock).lastInterviewBody as Record<string, unknown>;
    expect(body.jobOpeningId).toBe("job-1");
    expect(body.applicationId).toBe("app-4");
    expect(body.interviewerIds).toEqual(["interviewer-1"]);
    expect(Number.isNaN(new Date(body.scheduledAt as string).getTime())).toBe(false);

    expect(await within(dialog).findByText("Interview scheduled.")).toBeInTheDocument();
  });

  it("does not submit, and shows a required-fields message, when no interviewer or date has been entered", async () => {
    const fetchMock = mockShortlistedSequence();
    renderPage();
    const dialog = await openScheduleInterviewDialog();

    // Leave interviewer/date blank -- the browser's own `required` would
    // normally block this, but jsdom doesn't enforce it, so the component's
    // own guard (parsedInterviewerIds.length === 0 || !scheduledAt) is what's
    // actually under test here.
    fireEvent.submit(within(dialog).getByRole("button", { name: "Schedule Interview" }).closest("form") as HTMLFormElement);

    expect(await within(dialog).findByText(/please provide at least one interviewer/i)).toBeInTheDocument();
    expect((fetchMock as FetchMock).lastInterviewBody).toBeUndefined();
  });
});

// CRITICAL fix (Bug 2): the missing "Send Offer" action that left every
// shortlisted application dead-ended -- nothing in the UI could move an
// application past "shortlisted" toward the already-built Hire dialog.
// Wires the already-hardened PATCH .../offer (PR #1542); no test coverage
// of the wiring existed before this fix.
describe("JobOpeningDetailPage — send offer (Bug 2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const SHORTLISTED_APP = {
    id: "app-5",
    applicantName: "Meera Iyer",
    email: "meera@example.com",
    stage: "shortlisted",
    screeningDecision: "shortlisted",
  };

  function mockShortlistedSequence(offerStatus = 202) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("job-openings?limit=")) {
        return new Response(JSON.stringify({ data: [OPENING] }), { status: 200 });
      }
      if (url.match(/job-openings\/[^/]+\/applications$/)) {
        return new Response(JSON.stringify({ data: [SHORTLISTED_APP] }), { status: 200 });
      }
      if (url.match(/applications\/[^/]+\/offer$/)) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        (fn as FetchMock).lastOfferBody = body;
        return new Response(JSON.stringify({}), { status: offerStatus });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  async function openSendOfferDialog() {
    await screen.findByText("Meera Iyer");
    const row = screen.getByText("Meera Iyer").closest("div.px-5") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /application actions/i }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "Send Offer" }));
    return { dialog: await screen.findByRole("dialog"), row };
  }

  it("PATCHes .../offer with the CTC converted to paise, shows the sent confirmation, and moves the application to 'offered' (Mark Joined becomes available)", async () => {
    const fetchMock = mockShortlistedSequence();
    renderPage();
    const { dialog, row } = await openSendOfferDialog();

    fireEvent.change(within(dialog).getByLabelText(/ctc/i), { target: { value: "600000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send Offer" }));

    await waitFor(() => expect((fetchMock as FetchMock).lastOfferBody).toBeTruthy());
    const body = (fetchMock as FetchMock).lastOfferBody as Record<string, unknown>;
    expect(body.ctcMinor).toBe(60000000);
    expect(body.currency).toBe("INR");

    expect(await within(dialog).findByText("Offer sent.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    // Optimistic stage update: reopening the row's menu now shows the
    // "offered" bucket's actions (Mark Joined, disabled) instead of
    // Schedule Interview / Send Offer.
    fireEvent.click(within(row).getByRole("button", { name: /application actions/i }));
    expect(within(row).getByRole("menuitem", { name: "Mark Joined" })).toBeDisabled();
  });

  it("does not submit, and shows a required-fields message, for a zero or invalid CTC", async () => {
    const fetchMock = mockShortlistedSequence();
    renderPage();
    const { dialog } = await openSendOfferDialog();

    fireEvent.change(within(dialog).getByLabelText(/ctc/i), { target: { value: "0" } });
    // fireEvent.submit on the form directly, not a button click: the input
    // carries a `min="1"` HTML5 constraint, and clicking a submit button
    // with an out-of-range value never reaches React's onSubmit in jsdom
    // (native constraint validation blocks it first). Submitting the form
    // directly is what actually exercises the component's own guard
    // (ctcMinor <= 0), same as the schedule-interview test above.
    fireEvent.submit(within(dialog).getByRole("button", { name: "Send Offer" }).closest("form") as HTMLFormElement);

    expect(await within(dialog).findByText(/please enter a valid ctc/i)).toBeInTheDocument();
    expect((fetchMock as FetchMock).lastOfferBody).toBeUndefined();
  });
});
