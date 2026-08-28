import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

type FetchMock = ReturnType<typeof vi.fn> & { lastScreeningBody?: Record<string, unknown>; lastWithdrawBody?: Record<string, unknown> };

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "job-1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import JobOpeningDetailPage from "./page";

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

function mockFetchSequence(applications = [APPLIED_APP]) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("job-openings?limit=")) {
      return { ok: true, status: 200, json: async () => ({ data: [OPENING] }) } as Response;
    }
    if (url.match(/job-openings\/[^/]+\/applications$/)) {
      return { ok: true, status: 200, json: async () => ({ data: applications }) } as Response;
    }
    if (url.includes("/screening-decision")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      (fn as FetchMock).lastScreeningBody = body;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    if (url.endsWith("/withdraw")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      (fn as FetchMock).lastWithdrawBody = body;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    if (url.endsWith("/stage")) {
      // The dead route the page used to call — must never be hit again.
      return { ok: false, status: 404, json: async () => ({ message: "Route not found" }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
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
    render(<JobOpeningDetailPage />);
    const link = await screen.findByRole("link", { name: "Rahul Singh" });
    expect(link).toHaveAttribute("href", "/hr/recruitment/job-1/applications/app-2");
  });

  it("requires confirmation before rejecting an application (no bare one-click reject)", async () => {
    mockFetchSequence([APPLIED_APP]);
    render(<JobOpeningDetailPage />);
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
    render(<JobOpeningDetailPage />);
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
    render(<JobOpeningDetailPage />);
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
      if (url.includes("job-openings?limit=")) return { ok: true, status: 200, json: async () => ({ data: [OPENING] }) } as Response;
      if (url.match(/applications$/)) return { ok: true, status: 200, json: async () => ({ data: [APPLIED_APP] }) } as Response;
      if (url.includes("/screening-decision")) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fn);

    render(<JobOpeningDetailPage />);
    await screen.findByText("Asha Verma");
    const row = await openActionsMenu(/Asha Verma/);
    fireEvent.click(within(row).getByRole("menuitem", { name: "Shortlist" }));

    await waitFor(() => {
      expect(within(row).getByText(/action failed/i)).toBeInTheDocument();
    });
  });
});
