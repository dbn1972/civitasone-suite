import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "job-1", appId: "app-2" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

// Fast poll so the post-hire confirmation / stall paths run in real time.
vi.mock("./applicationData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HIRE_POLL_INTERVAL_MS: 15,
  HIRE_POLL_MAX_ATTEMPTS: 3,
}));

import ApplicationDetailPage from "./page";

function renderPage(locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <ApplicationDetailPage />
    </NextIntlClientProvider>,
  );
}

const APP = {
  id: "app-2", jobOpeningId: "job-1", applicantName: "Rahul Singh", stage: "selected", screeningDecision: "eligible",
  source: "public", appliedAt: "2026-08-02", email: "rahul@example.com",
};

const DEPARTMENTS = { data: [{ id: "dept-1", name: "IT Department" }] };
const DESIGNATIONS = { data: [{ id: "desig-1", name: "Software Engineer" }] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Routes = Record<string, (init?: RequestInit) => Response | Promise<Response>>;
/** Routes a fetch by exact URL; unknown URLs fail the test loudly. Fee/offers default to empty. */
function stubFetch(routes: Routes) {
  const calls: string[] = [];
  const base: Routes = {
    "/api/proxy/v1/hrms/applications/app-2/fee": () => json({ message: "none" }, 404),
    "/api/proxy/v1/hrms/applications/app-2/offers": () => json({ data: [] }),
    "/api/proxy/v1/hrms/applications/app-2/scorecards": () => json({ data: [] }),
    ...routes,
  };
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    const h = base[url];
    if (!h) throw new Error(`unexpected fetch to ${url}`);
    return h(init);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

const APP_URL = "/api/proxy/v1/hrms/applications/app-2";
const HIRE_URL = "/api/proxy/v1/hrms/applications/app-2/hire";
const DEPT_URL = "/api/proxy/v1/hrms/departments?limit=200";
const DESIG_URL = "/api/proxy/v1/hrms/designations?limit=200";

async function fillHireForm() {
  fireEvent.click(await screen.findByRole("button", { name: "Hire" }));
  await waitFor(() => expect(screen.getByRole("option", { name: /it department/i })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/employee no/i), { target: { value: "EMP-2026-001" } });
  fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText(/basic pay/i), { target: { value: "50000" } });
  fireEvent.change(screen.getByLabelText("Department", { exact: false }), { target: { value: "dept-1" } });
  fireEvent.change(screen.getByLabelText("Designation", { exact: false }), { target: { value: "desig-1" } });
}

describe("ApplicationDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  // GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-05
  it("loads ONE application via the singular GET and never downloads the vacancy's whole applicant list", async () => {
    const { calls } = stubFetch({ [APP_URL]: () => json(APP) });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Rahul Singh" })).toBeInTheDocument();
    expect(screen.getByText("Screening decision")).toBeInTheDocument();
    expect(screen.getByText("Eligible")).toBeInTheDocument();
    expect(calls).toContain(APP_URL);
    expect(calls.some((u) => u.includes("/job-openings/"))).toBe(false);
  });

  // GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-02
  it("shows the application number, translated enums and an IST date instead of the UUID, raw tokens and ISO timestamp", async () => {
    stubFetch({
      [APP_URL]: () => json({ ...APP, applicationNo: "REC/2026/0042", stage: "offered", screeningDecision: "pending", source: "public_portal", appliedAt: "2026-03-01T10:00:00Z" }),
    });
    renderPage();
    await screen.findByRole("heading", { name: "Rahul Singh" });
    expect(screen.getByText("REC/2026/0042")).toBeInTheDocument();
    expect(screen.queryByText("app-2")).not.toBeInTheDocument();
    expect(screen.getByText("Public careers portal")).toBeInTheDocument();
    expect(screen.getByText("Offered")).toBeInTheDocument();
    expect(screen.getByText(/1 Mar 2026/)).toBeInTheDocument();
  });

  // GAP-...-APPLICATION-06
  it("shows category, date of birth (when the API returns it) and résumé status in the summary", async () => {
    stubFetch({ [APP_URL]: () => json({ ...APP, category: "OBC", dateOfBirth: "1995-04-12", hasResume: true }) });
    renderPage();
    await screen.findByRole("heading", { name: "Rahul Singh" });
    expect(screen.getByText("OBC")).toBeInTheDocument();
    expect(screen.getByText(/12 Apr 1995/)).toBeInTheDocument();
    expect(screen.getByText("On file")).toBeInTheDocument();
  });

  it("hides date of birth entirely when the API withheld it (hr_officer)", async () => {
    stubFetch({ [APP_URL]: () => json({ ...APP, category: "UR", dateOfBirth: null, hasResume: false }) });
    renderPage();
    await screen.findByRole("heading", { name: "Rahul Singh" });
    expect(screen.queryByText("Date of birth")).not.toBeInTheDocument();
    expect(screen.getByText("Not provided")).toBeInTheDocument();
  });

  // GAP-RECRUITMENT-DETAIL-08: the single-record view shows the service-masked address with an audited reveal.
  it("shows the masked email with a Reveal control, never the raw address", async () => {
    stubFetch({ [APP_URL]: () => json({ ...APP, email: "r***@e***.com", contactMasked: true }) });
    renderPage();
    await screen.findByRole("heading", { name: "Rahul Singh" });
    expect(screen.getByTestId("contact-app-2")).toHaveTextContent("r***@e***.com");
    expect(screen.getByRole("button", { name: /reveal contact details for rahul singh/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("rahul@example.com");
  });

  it("opens an uploaded resume through the audited short-lived link (https only)", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    stubFetch({
      [APP_URL]: () => json({ ...APP, hasResume: true, resumeViewable: true }),
      "/api/proxy/v1/hrms/applications/app-2/resume-link": () => json({ data: { url: "https://files.example/resume.pdf", expiresInSeconds: 300 } }),
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "View resume" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://files.example/resume.pdf", "_blank", "noopener,noreferrer"));
    open.mockRestore();
  });

  it("refuses a non-https resume link", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    stubFetch({
      [APP_URL]: () => json({ ...APP, hasResume: true, resumeViewable: true }),
      "/api/proxy/v1/hrms/applications/app-2/resume-link": () => json({ data: { url: "javascript:alert(1)" } }),
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "View resume" }));
    expect(await screen.findByText("The resume could not be opened.")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("the fee button opens the fee dialog (assess / record an offline payment)", async () => {
    stubFetch({ [APP_URL]: () => json(APP) });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Manage fee" }));
    expect(await screen.findByText(/no fee has been assessed/i)).toBeInTheDocument();
  });

  it("renders the fee, offers and PDF link sections", async () => {
    stubFetch({
      [APP_URL]: () => json(APP),
      "/api/proxy/v1/hrms/applications/app-2/fee": () => json({ data: { status: "paid", amountMinor: "10000", paidAt: "2026-08-05T10:00:00Z" } }),
      "/api/proxy/v1/hrms/applications/app-2/offers": () => json({ data: [{ id: "off-1", offerNo: "OFR-AAAA1111", status: "released", offerVersion: 2, grossCtcMinor: "60000000" }] }),
    });
    renderPage();
    await screen.findByRole("heading", { name: "Rahul Singh" });
    const feeCard = (await screen.findByText("Application fee")).closest(".card") as HTMLElement;
    await waitFor(() => expect(within(feeCard).getByText("₹100.00")).toBeInTheDocument());
    expect(within(feeCard).getByText("Paid")).toBeInTheDocument();
    expect(await screen.findByText("OFR-AAAA1111")).toBeInTheDocument();
    expect(screen.getByText(/₹6,00,000\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download application PDF" })).toHaveAttribute("href", "/api/proxy/v1/hrms/applications/app-2/pdf");
  });

  it("a failing fee call shows a section error with Retry and does not blank the rest of the page", async () => {
    let feeCalls = 0;
    stubFetch({
      [APP_URL]: () => json(APP),
      "/api/proxy/v1/hrms/applications/app-2/fee": () => (feeCalls++ === 0 ? json({ code: "INTERNAL" }, 500) : json({ data: { status: "pending", amountMinor: "5000" } })),
      "/api/proxy/v1/hrms/applications/app-2/offers": () => json({ data: [] }),
    });
    renderPage();
    expect(await screen.findByText(/could not load the fee status/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rahul Singh" })).toBeInTheDocument();
    expect(await screen.findByText("No offers have been made yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("₹50.00")).toBeInTheDocument();
  });

  it("treats a 404 from the fee endpoint as 'no fee assessed', not an error", async () => {
    stubFetch({ [APP_URL]: () => json(APP) });
    renderPage();
    expect(await screen.findByText("No fee has been assessed for this application.")).toBeInTheDocument();
    expect(screen.queryByText(/could not load the fee status/i)).not.toBeInTheDocument();
  });

  // GAP-...-APPLICATION-07
  it("a 404 shows the not-found state with a Back to pipeline button, not the error state", async () => {
    stubFetch({ [APP_URL]: () => json({ code: "NOT_FOUND" }, 404) });
    renderPage();
    expect(await screen.findByText("Application not found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to pipeline" })).toHaveAttribute("href", "/hr/recruitment/job-1");
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
  });

  it("an application that belongs to a different vacancy than the URL is not found", async () => {
    stubFetch({ [APP_URL]: () => json({ ...APP, jobOpeningId: "job-OTHER" }) });
    renderPage();
    expect(await screen.findByText("Application not found.")).toBeInTheDocument();
    expect(screen.queryByText("Rahul Singh")).not.toBeInTheDocument();
  });

  it("a 500 shows the error state with Retry (not 'Application not found'), and Retry re-runs the load", async () => {
    let n = 0;
    stubFetch({ [APP_URL]: () => (n++ === 0 ? new Response("", { status: 500 }) : json(APP)) });
    renderPage();
    await waitFor(() => expect(screen.getByText(/couldn't load application/i)).toBeInTheDocument());
    expect(screen.queryByText("Application not found.")).not.toBeInTheDocument();
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByRole("heading", { name: "Rahul Singh" })).toBeInTheDocument();
  });

  it("a 403 error offers no pointless Retry", async () => {
    stubFetch({ [APP_URL]: () => json({ code: "FORBIDDEN", message: "requires one of: hr_admin" }, 403) });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
  });

  it("links back to the job opening detail page", async () => {
    stubFetch({ [APP_URL]: () => json(APP) });
    renderPage();
    await screen.findByRole("heading", { name: "Rahul Singh" });
    expect(screen.getByRole("link", { name: /back to applications/i })).toHaveAttribute("href", "/hr/recruitment/job-1");
  });

  // GAP-...-APPLICATION-08
  it("translates the back link and the select placeholders (Hindi)", async () => {
    stubFetch({ [APP_URL]: () => json(APP), [DEPT_URL]: () => json(DEPARTMENTS), [DESIG_URL]: () => json(DESIGNATIONS) });
    renderPage("hi");
    await screen.findByRole("heading", { name: "Rahul Singh" });
    expect(screen.getByRole("link", { name: hiMessages.recruitmentApplicationDetail.backToApplications })).toBeInTheDocument();
    expect(screen.queryByText("Back to Applications")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: hiMessages.recruitmentApplicationDetail.hire }));
    expect(await screen.findByRole("option", { name: hiMessages.recruitmentApplicationDetail.selectDepartment })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: hiMessages.recruitmentApplicationDetail.selectDesignation })).toBeInTheDocument();
  });

  // GAP-...-APPLICATION-04
  it("labels the hire fields Department / Designation (not '... ID') and shows names", async () => {
    stubFetch({ [APP_URL]: () => json(APP), [DEPT_URL]: () => json(DEPARTMENTS), [DESIG_URL]: () => json(DESIGNATIONS) });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Hire" }));
    await waitFor(() => expect(screen.getByRole("option", { name: /it department/i })).toBeInTheDocument());
    expect(screen.getByLabelText("Department", { exact: false })).toBeInTheDocument();
    expect(screen.queryByLabelText(/department id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/designation id/i)).not.toBeInTheDocument();
  });

  it("with the departments API failing there is NO free-text UUID box: a disabled select, an inline error and a working Retry", async () => {
    let deptCalls = 0;
    stubFetch({
      [APP_URL]: () => json(APP),
      [DEPT_URL]: () => (deptCalls++ === 0 ? new Response("", { status: 500 }) : json(DEPARTMENTS)),
      [DESIG_URL]: () => json(DESIGNATIONS),
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Hire" }));
    expect(await screen.findByText("Could not load departments.")).toBeInTheDocument();
    const dept = screen.getByLabelText("Department", { exact: false }) as HTMLSelectElement;
    expect(dept.tagName).toBe("SELECT");
    expect(dept).toBeDisabled();
    expect(screen.queryByPlaceholderText("UUID")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("option", { name: /it department/i })).toBeInTheDocument());
    expect(dept).not.toBeDisabled();
  });

  // GAP-...-APPLICATION-03
  it("restates what will be created (employee no, department, designation, joining date, pay) before Confirm Hire", async () => {
    stubFetch({ [APP_URL]: () => json(APP), [DEPT_URL]: () => json(DEPARTMENTS), [DESIG_URL]: () => json(DESIGNATIONS) });
    renderPage();
    await fillHireForm();
    const summary = screen.getByText(/you are about to hire/i);
    expect(summary).toHaveTextContent("Software Engineer");
    expect(summary).toHaveTextContent("IT Department");
    expect(summary).toHaveTextContent("EMP-2026-001");
    expect(summary).toHaveTextContent("₹50,000.00");
  });

  it("after a 202 the stage does NOT flip to Hired: it shows 'Hire queued', hides the Hire button and posts basic pay in paise", async () => {
    let posted: Record<string, unknown> | null = null;
    stubFetch({
      [APP_URL]: () => json(APP),
      [DEPT_URL]: () => json(DEPARTMENTS),
      [DESIG_URL]: () => json(DESIGNATIONS),
      [HIRE_URL]: (init) => { posted = JSON.parse(String(init?.body)); return new Response("{}", { status: 202 }); },
    });
    renderPage();
    await fillHireForm();
    fireEvent.click(screen.getByRole("button", { name: /confirm hire/i }));
    expect(await screen.findByText(/hire queued/i)).toBeInTheDocument();
    expect(posted).toMatchObject({ employeeNo: "EMP-2026-001", basicMinor: 5000000, departmentId: "dept-1", designationId: "desig-1" });
    expect(screen.queryByRole("button", { name: "Hire" })).not.toBeInTheDocument();
    const stageRow = screen.getByText("Stage").parentElement as HTMLElement;
    expect(stageRow).toHaveTextContent("Selected");
    expect(stageRow).not.toHaveTextContent("Hired");
  });

  it("flips to Hired only once a refetch from the server returns stage hired", async () => {
    let appFetches = 0;
    stubFetch({
      [APP_URL]: () => json(++appFetches >= 3 ? { ...APP, stage: "hired" } : APP),
      [DEPT_URL]: () => json(DEPARTMENTS),
      [DESIG_URL]: () => json(DESIGNATIONS),
      [HIRE_URL]: () => new Response("{}", { status: 202 }),
    });
    renderPage();
    await fillHireForm();
    fireEvent.click(screen.getByRole("button", { name: /confirm hire/i }));
    expect(await screen.findByText(/hire queued/i)).toBeInTheDocument();
    expect(await screen.findByText(/hire completed/i)).toBeInTheDocument();
    expect(screen.getByText("Stage").parentElement).toHaveTextContent("Hired");
    expect(screen.queryByText(/hire queued/i)).not.toBeInTheDocument();
  });

  it("warns that the hire did not complete when the consumer never moves the stage to hired", async () => {
    stubFetch({
      [APP_URL]: () => json(APP),
      [DEPT_URL]: () => json(DEPARTMENTS),
      [DESIG_URL]: () => json(DESIGNATIONS),
      [HIRE_URL]: () => new Response("{}", { status: 202 }),
    });
    renderPage();
    await fillHireForm();
    fireEvent.click(screen.getByRole("button", { name: /confirm hire/i }));
    const warning = await screen.findByText(/has not completed yet/i);
    expect(warning).toBeInTheDocument();
    expect(screen.queryByText(/hire completed/i)).not.toBeInTheDocument();
    expect(screen.getByText("Stage").parentElement).toHaveTextContent("Selected");
  });

  /**
   * UX-016: the pipeline load used to show `Failed to load (${res.status})`
   * and the hire submit used to show the raw response text verbatim.
   */
  describe("UX-016 clerk-safe errors", () => {
    it("shows a clerk-safe message, never the raw server text, when hiring fails", async () => {
      stubFetch({
        [APP_URL]: () => json(APP),
        [DEPT_URL]: () => json(DEPARTMENTS),
        [DESIG_URL]: () => json(DESIGNATIONS),
        [HIRE_URL]: () => new Response("hrms-service: hire command rejected", { status: 500 }),
      });
      renderPage();
      await fillHireForm();
      fireEvent.click(screen.getByRole("button", { name: /confirm hire/i }));

      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
      expect(alert.textContent).not.toMatch(/hrms-service/);
      expect(alert.textContent).not.toMatch(/\b500\b/);
    });
  });

  describe("locale-safe not-found message", () => {
    it("shows the not-found message in the new language after a locale switch", async () => {
      stubFetch({ [APP_URL]: () => json({ code: "NOT_FOUND" }, 404) });
      const { rerender } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <ApplicationDetailPage />
        </NextIntlClientProvider>,
      );
      expect(await screen.findByText("Application not found.")).toBeInTheDocument();
      rerender(
        <NextIntlClientProvider locale="hi" messages={hiMessages}>
          <ApplicationDetailPage />
        </NextIntlClientProvider>,
      );
      expect(await screen.findByText(hiMessages.recruitmentApplicationDetail.notFoundMessage)).toBeInTheDocument();
      expect(screen.queryByText("Application not found.")).not.toBeInTheDocument();
    });
  });
});
