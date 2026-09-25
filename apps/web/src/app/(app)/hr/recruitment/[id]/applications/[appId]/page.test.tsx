import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "job-1", appId: "app-2" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import ApplicationDetailPage from "./page";

// UX-017: ApplicationDetailPage now reads its copy through next-intl
// (useTranslations("recruitmentApplicationDetail")), so it needs a real
// provider in the tree -- same pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ApplicationDetailPage />
    </NextIntlClientProvider>,
  );
}

const LIST_RESPONSE = {
  data: [
    { id: "app-1", applicantName: "Asha Verma", stage: "applied", screeningDecision: "pending", source: "public", appliedAt: "2026-08-01" },
    { id: "app-2", applicantName: "Rahul Singh", stage: "selected", screeningDecision: "eligible", source: "public", appliedAt: "2026-08-02", email: "rahul@example.com" },
  ],
};

// UX: the hire dialog's departmentId/designationId now render as
// name-based dropdowns (populated from these lists) instead of raw UUID
// text boxes — see page.tsx's dropdown-vs-fallback-input branches.
const DEPARTMENTS_RESPONSE = { data: [{ id: "dept-1", name: "IT Department" }] };
const DESIGNATIONS_RESPONSE = { data: [{ id: "desig-1", name: "Software Engineer" }] };

describe("ApplicationDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the application via the job-opening's applications list, not the nonexistent singular GET", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/proxy/v1/hrms/job-openings/job-1/applications") {
        return { ok: true, status: 200, json: async () => LIST_RESPONSE } as Response;
      }
      // GET /v1/hrms/applications/:id does not exist (confirmed 404 live) — if the
      // page ever calls it again, fail the test loudly instead of pretending it works.
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(await screen.findByRole("heading", { name: "Rahul Singh" })).toBeInTheDocument();
    expect(screen.getByText("Screening decision")).toBeInTheDocument();
    expect(screen.getByText("eligible")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/hrms/job-openings/job-1/applications");
  });

  it("shows a clean not-found state when the id isn't in the pipeline, with a working way back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) } as Response)));
    renderPage();

    expect(await screen.findByText("Application not found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute("href", "/hr/recruitment/job-1");
  });

  it("links back to the job opening detail page, not the broken relative '.' (which 404s under this nested route)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => LIST_RESPONSE } as Response)));
    renderPage();
    await screen.findByRole("heading", { name: "Rahul Singh" });
    expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute("href", "/hr/recruitment/job-1");
  });

  it("hides the Hire action once a hire has been initiated, so it can't be double-submitted", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/proxy/v1/hrms/job-openings/job-1/applications") {
        return { ok: true, status: 200, json: async () => LIST_RESPONSE } as Response;
      }
      if (url === "/api/proxy/v1/hrms/departments?limit=200") {
        return { ok: true, status: 200, json: async () => DEPARTMENTS_RESPONSE } as Response;
      }
      if (url === "/api/proxy/v1/hrms/designations?limit=200") {
        return { ok: true, status: 200, json: async () => DESIGNATIONS_RESPONSE } as Response;
      }
      if (url === "/api/proxy/v1/hrms/applications/app-2/hire" && init?.method === "POST") {
        return { ok: true, status: 202, text: async () => "{}" } as Response;
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Hire" }));

    await waitFor(() => expect(screen.getByRole("option", { name: /it department/i })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/employee no/i), { target: { value: "EMP-2026-001" } });
    fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-09-01" } });
    // MEDIUM finding: Basic Pay now defaults to empty and the backend rejects
    // 0 (hireApplicationBody.basicMinor is z.number().int().positive()) — a
    // real positive value is required to get past the form's own
    // client-side validation to the hire submission this test is about.
    fireEvent.change(screen.getByLabelText(/basic pay/i), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/department id/i), { target: { value: "dept-1" } });
    fireEvent.change(screen.getByLabelText(/designation id/i), { target: { value: "desig-1" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm hire/i }));

    await waitFor(() => {
      expect(screen.getByText(/hire initiated/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Hire" })).not.toBeInTheDocument();
  });

  /**
   * UX-016: the pipeline load used to show `Failed to load (${res.status})`
   * and the hire submit used to show the raw response text (falling back to
   * `Request failed (${res.status})`) verbatim — the same class of leak
   * useFormError closes fleet-wide (UX-003).
   */
  describe("UX-016 clerk-safe errors", () => {
    it("shows a clerk-safe message, never the raw HTTP status, when the pipeline fails to load", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
      renderPage();

      // Scoped to the toHumanError "area" text (not just /couldn't load/i)
      // since this page's own DataSourceBadge also shows a generic
      // "Couldn't load — showing nothing" pill on this same error state.
      await waitFor(() => expect(screen.getByText(/couldn't load this application/i)).toBeInTheDocument());
      expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
    });

    it("shows a clerk-safe message, never the raw server text, when hiring fails", async () => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/proxy/v1/hrms/job-openings/job-1/applications") {
          return new Response(JSON.stringify(LIST_RESPONSE), { status: 200 });
        }
        if (url === "/api/proxy/v1/hrms/departments?limit=200") {
          return new Response(JSON.stringify(DEPARTMENTS_RESPONSE), { status: 200 });
        }
        if (url === "/api/proxy/v1/hrms/designations?limit=200") {
          return new Response(JSON.stringify(DESIGNATIONS_RESPONSE), { status: 200 });
        }
        if (url === "/api/proxy/v1/hrms/applications/app-2/hire" && init?.method === "POST") {
          return new Response("hrms-service: hire command rejected", { status: 500 });
        }
        throw new Error(`unexpected fetch to ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Hire" }));
      await waitFor(() => expect(screen.getByRole("option", { name: /it department/i })).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/employee no/i), { target: { value: "EMP-2026-001" } });
      fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-09-01" } });
      // MEDIUM finding: a real positive Basic Pay is now required client-side
      // before submit is even attempted — see the sibling test above.
      fireEvent.change(screen.getByLabelText(/basic pay/i), { target: { value: "50000" } });
      fireEvent.change(screen.getByLabelText(/department id/i), { target: { value: "dept-1" } });
      fireEvent.change(screen.getByLabelText(/designation id/i), { target: { value: "desig-1" } });
      fireEvent.click(screen.getByRole("button", { name: /confirm hire/i }));

      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
      expect(alert.textContent).not.toMatch(/hrms-service/);
      expect(alert.textContent).not.toMatch(/\b500\b/);
    });
  });

  /**
   * Stale i18n closure regression (react-hooks/exhaustive-deps follow-up):
   * the load effect's not-found branch calls t("notFoundMessage"), but `t`
   * was missing from the effect's dependency array (only
   * [appId, jobOpeningId]) -- so it kept using whatever `t` was in scope
   * when the effect last actually ran, regardless of a later locale switch,
   * until appId/jobOpeningId changed again. Same bug class already fixed in
   * CreateLeavePolicyForm.tsx (see that file's own test of the same name).
   */
  describe("locale-safe not-found message", () => {
    it("shows the not-found message in the new language after a locale switch, not the one active when the effect last ran", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) } as Response)));

      const { rerender } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <ApplicationDetailPage />
        </NextIntlClientProvider>,
      );
      expect(await screen.findByText("Application not found.")).toBeInTheDocument();

      // appId/jobOpeningId are unchanged (mocked as constant via useParams) --
      // only `t` itself changes here, exactly the case the missing
      // dependency mishandled.
      rerender(
        <NextIntlClientProvider locale="hi" messages={hiMessages}>
          <ApplicationDetailPage />
        </NextIntlClientProvider>,
      );

      await waitFor(() => expect(screen.getByText("आवेदन नहीं मिला।")).toBeInTheDocument());
      expect(screen.queryByText("Application not found.")).not.toBeInTheDocument();
    });
  });
});
