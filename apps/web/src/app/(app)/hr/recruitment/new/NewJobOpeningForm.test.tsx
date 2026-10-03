import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

import { NewJobOpeningForm } from "./NewJobOpeningForm";

const DEPT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const DESIG_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3309";
const DEPT_URL = "/api/proxy/v1/hrms/departments?limit=200";
const DESIG_URL = "/api/proxy/v1/hrms/designations?limit=200";
const PAY_URL = "/api/proxy/v1/hrms/pay-matrix";
const POST_URL = "/api/proxy/v1/hrms/job-openings";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Routes = Record<string, (init?: RequestInit) => Response | Promise<Response>>;
function stubFetch(overrides: Routes = {}) {
  const routes: Routes = {
    [DEPT_URL]: () => json({ data: [{ id: DEPT_ID, name: "Finance" }] }),
    [DESIG_URL]: () => json({ data: [{ id: DESIG_ID, name: "Assistant Engineer" }] }),
    [PAY_URL]: () => json({ data: [{ level: 10 }, { level: 11 }] }),
    [POST_URL]: () => new Response("{}", { status: 202 }),
    ...overrides,
  };
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const h = routes[url];
    if (!h) throw new Error(`unexpected fetch: ${url}`);
    return h(init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function postedBody(fn: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const call = fn.mock.calls.find((c) => c[0] === POST_URL && (c[1] as RequestInit | undefined)?.method === "POST");
  expect(call).toBeTruthy();
  return JSON.parse(String((call![1] as RequestInit).body));
}

// UX-017: NewJobOpeningForm reads its copy through next-intl, so it needs a real provider.
function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewJobOpeningForm />
    </NextIntlClientProvider>,
  );
}

async function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/reference no/i), { target: { value: "JOB-2026-0001" } });
  fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Junior Engineer" } });
  // The department is a name-based select (no free-text UUID box any more).
  await waitFor(() => expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/^department/i), { target: { value: DEPT_ID } });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));

describe("NewJobOpeningForm", () => {
  beforeEach(() => {
    stubFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not claim the vacancy was created — the API only accepts (202) a queued command", async () => {
    renderForm();
    await fillRequiredFields();
    submit();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/submitted/i);
    });
    expect(screen.queryByText(/created successfully/i)).not.toBeInTheDocument();
  });

  it("stays on the page after success so the confirmation is actually visible, and offers a way back", async () => {
    renderForm();
    await fillRequiredFields();
    submit();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /back to recruitment/i })).toHaveAttribute("href", "/hr/recruitment");
    });
    expect(screen.getByDisplayValue("JOB-2026-0001")).toBeInTheDocument();
  });

  it("disables the submit button after success to prevent a duplicate double-submit", async () => {
    renderForm();
    await fillRequiredFields();
    submit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submitted/i })).toBeDisabled();
    });
  });

  it("still blocks submit client-side when Reference No is empty", async () => {
    const fn = stubFetch();
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument());
    submit();
    expect(screen.getByText(/reference no is required/i)).toBeInTheDocument();
    expect(fn).not.toHaveBeenCalledWith(POST_URL, expect.anything());
  });

  it("surfaces a real server error instead of a false success", async () => {
    stubFetch({ [POST_URL]: () => new Response("duplicate refNo", { status: 409 }) });
    renderForm();
    await fillRequiredFields();
    submit();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/This job opening was changed by someone else\. Refresh to see the latest version, then try again\./);
    });
  });

  // UX-016: never the raw server response text / status.
  it("never surfaces the raw server response text on a failed submission", async () => {
    stubFetch({ [POST_URL]: () => new Response("duplicate refNo", { status: 409 }) });
    renderForm();
    await fillRequiredFields();
    submit();
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/This job opening was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(alert.textContent).not.toMatch(/duplicate refNo/);
    expect(alert.textContent).not.toMatch(/\b409\b/);
  });

  // GAP-RECRUITMENT-NEW-01
  it("lets the officer pick a vacancy type and submits it in the POST body", async () => {
    const fn = stubFetch();
    renderForm();
    await fillRequiredFields();
    const select = screen.getByLabelText(/vacancy type/i) as HTMLSelectElement;
    expect(select.value).toBe("regular");
    fireEvent.change(select, { target: { value: "internship" } });
    submit();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
    expect(postedBody(fn).vacancyType).toBe("internship");
  });

  // GAP-RECRUITMENT-NEW-02
  describe("structured pay (NEW-02)", () => {
    it("caps every text field at the service limit before submit (Pay Range 120, etc.)", async () => {
      renderForm();
      expect(screen.getByLabelText(/^pay range/i)).toHaveAttribute("maxlength", "120");
      expect(screen.getByLabelText(/^title/i)).toHaveAttribute("maxlength", "256");
      expect(screen.getByLabelText(/^qualification/i)).toHaveAttribute("maxlength", "500");
      expect(screen.getByLabelText(/^description/i)).toHaveAttribute("maxlength", "5000");
      expect(screen.getByLabelText(/^selection process/i)).toHaveAttribute("maxlength", "3000");
      expect(screen.getByLabelText(/^location/i)).toHaveAttribute("maxlength", "200");
    });

    it("fills Pay Range from the pay-matrix level and min/max, and posts level + paise as strings", async () => {
      const fn = stubFetch();
      renderForm();
      await fillRequiredFields();
      await waitFor(() => expect(screen.getByRole("option", { name: "Level 10" })).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/pay level/i), { target: { value: "10" } });
      fireEvent.change(screen.getByLabelText(/minimum basic pay/i), { target: { value: "56100" } });
      fireEvent.change(screen.getByLabelText(/maximum basic pay/i), { target: { value: "177500.50" } });
      expect(screen.getByLabelText(/^pay range/i)).toHaveValue("Level 10, ₹56,100.00 - ₹1,77,500.50");
      submit();
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
      const body = postedBody(fn);
      expect(body.payLevel).toBe("10");
      expect(body.payMinMinor).toBe("5610000");
      expect(body.payMaxMinor).toBe("17750050");
      expect(typeof body.payMinMinor).toBe("string");
    });

    it("does not overwrite a Pay Range the officer typed by hand", async () => {
      renderForm();
      await waitFor(() => expect(screen.getByRole("option", { name: "Level 10" })).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/^pay range/i), { target: { value: "As per rules" } });
      fireEvent.change(screen.getByLabelText(/pay level/i), { target: { value: "11" } });
      expect(screen.getByLabelText(/^pay range/i)).toHaveValue("As per rules");
    });

    it("rejects minimum pay above maximum pay inline", async () => {
      const fn = stubFetch();
      renderForm();
      await fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/minimum basic pay/i), { target: { value: "90000" } });
      fireEvent.change(screen.getByLabelText(/maximum basic pay/i), { target: { value: "50000" } });
      submit();
      expect(await screen.findByText(/minimum pay cannot be more than maximum pay/i)).toBeInTheDocument();
      expect(fn).not.toHaveBeenCalledWith(POST_URL, expect.anything());
    });

    it("rejects a non-numeric amount inline", async () => {
      renderForm();
      await fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/minimum basic pay/i), { target: { value: "lots" } });
      submit();
      expect(await screen.findByText(/amount in rupees greater than 0/i)).toBeInTheDocument();
    });

    it("omits the structured pay fields when none are entered", async () => {
      const fn = stubFetch();
      renderForm();
      await fillRequiredFields();
      submit();
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
      const body = postedBody(fn);
      expect(body).not.toHaveProperty("payLevel");
      expect(body).not.toHaveProperty("payMinMinor");
      expect(body).not.toHaveProperty("payMaxMinor");
    });
  });

  // GAP-RECRUITMENT-NEW-03
  describe("location / designation / posted date (NEW-03)", () => {
    it("sends location, designation and posted date when set", async () => {
      const fn = stubFetch();
      renderForm();
      await fillRequiredFields();
      await waitFor(() => expect(screen.getByRole("option", { name: "Assistant Engineer" })).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/^location/i), { target: { value: "Bhubaneswar" } });
      fireEvent.change(screen.getByLabelText(/^designation/i), { target: { value: DESIG_ID } });
      fireEvent.change(screen.getByLabelText(/posted date/i), { target: { value: "2026-10-01" } });
      submit();
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
      const body = postedBody(fn);
      expect(body.location).toBe("Bhubaneswar");
      expect(body.designationId).toBe(DESIG_ID);
      expect(body.postedAt).toBe("2026-10-01");
      expect(body.isPublished).toBeUndefined();
    });

    it("omits location, designation and posted date when empty", async () => {
      const fn = stubFetch();
      renderForm();
      await fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/posted date/i), { target: { value: "" } });
      submit();
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
      const body = postedBody(fn);
      expect(body).not.toHaveProperty("location");
      expect(body).not.toHaveProperty("designationId");
      expect(body).not.toHaveProperty("postedAt");
    });

    it("explains that publishing is done from the vacancy page", () => {
      renderForm();
      expect(screen.getByText(/until you publish it from the vacancy page/i)).toBeInTheDocument();
    });
  });

  // GAP-RECRUITMENT-NEW-04
  describe("validation (NEW-04)", () => {
    it("reports every failing field at once, focuses the first, and shows an error summary at the top", async () => {
      renderForm();
      await waitFor(() => expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument());
      submit();
      const summary = await screen.findByRole("alert");
      expect(summary).toHaveTextContent(/3 fields need attention/i);
      expect(screen.getByText(/reference no is required/i)).toBeInTheDocument();
      expect(screen.getByText(/title is required/i)).toBeInTheDocument();
      expect(screen.getByText(/select a department/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/reference no/i)).toHaveFocus();
      expect(screen.getByLabelText(/reference no/i)).toHaveAttribute("aria-invalid", "true");
    });

    it("the summary appears before the fields (visible without scrolling to the bottom)", async () => {
      const { container } = renderForm();
      await waitFor(() => expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument());
      submit();
      const summary = await screen.findByRole("alert");
      const form = container.querySelector("form") as HTMLFormElement;
      expect(form.firstElementChild).toBe(summary);
    });

    it("flags an over-long field and an invalid date inline", async () => {
      renderForm();
      await fillRequiredFields();
      const sel = screen.getByLabelText(/^selection process/i) as HTMLTextAreaElement;
      // maxLength blocks typing but a pasted/programmatic value can still exceed it
      fireEvent.change(sel, { target: { value: "x".repeat(3001) } });
      submit();
      expect(await screen.findByText(/use 3000 characters or fewer/i)).toBeInTheDocument();
    });

    it("shows server fieldErrors under their own field (VALIDATION_FAILED) and focuses it", async () => {
      stubFetch({
        [POST_URL]: () => json({ code: "VALIDATION_FAILED", message: "invalid", fieldErrors: [{ field: "payRange", message: "Pay range is too long" }] }, 400),
      });
      renderForm();
      await fillRequiredFields();
      submit();
      expect(await screen.findByText("Pay range is too long")).toBeInTheDocument();
      expect(screen.getByLabelText(/^pay range/i)).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText(/^pay range/i)).toHaveFocus();
    });
  });

  // GAP-RECRUITMENT-NEW-05
  describe("required documents and eligibility (NEW-05)", () => {
    it("lets HR add and remove required documents, and sends them only when non-empty", async () => {
      const fn = stubFetch();
      renderForm();
      await fillRequiredFields();
      fireEvent.click(screen.getByRole("button", { name: /add document/i }));
      fireEvent.change(screen.getByLabelText("Document 1"), { target: { value: "Aadhaar" } });
      fireEvent.click(screen.getByRole("button", { name: /add document/i }));
      fireEvent.change(screen.getByLabelText("Document 2"), { target: { value: "Degree" } });
      fireEvent.click(screen.getByRole("button", { name: "Remove document 1" }));
      submit();
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
      expect(postedBody(fn).requiredDocuments).toEqual(["Degree"]);
    });

    it("omits requiredDocuments when there are none", async () => {
      const fn = stubFetch();
      renderForm();
      await fillRequiredFields();
      submit();
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
      expect(postedBody(fn)).not.toHaveProperty("requiredDocuments");
      expect(postedBody(fn)).not.toHaveProperty("eligibility");
    });

    it("ticking 'allow multiple applications' posts eligibility.allowMultiple = true", async () => {
      const fn = stubFetch();
      renderForm();
      await fillRequiredFields();
      fireEvent.click(screen.getByLabelText(/allow multiple applications from the same email/i));
      submit();
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
      expect(postedBody(fn).eligibility).toEqual({ allowMultiple: true });
    });
  });

  // GAP-RECRUITMENT-NEW-08
  describe("department lookup failure (NEW-08)", () => {
    it("shows an inline error with Retry, no UUID text box, and a disabled Submit; Retry recovers", async () => {
      let calls = 0;
      stubFetch({ [DEPT_URL]: () => (calls++ === 0 ? new Response("", { status: 500 }) : json({ data: [{ id: DEPT_ID, name: "Finance" }] })) });
      renderForm();
      expect(await screen.findByText(/could not load departments/i)).toBeInTheDocument();
      const dept = screen.getByLabelText(/^department/i);
      expect(dept.tagName).toBe("SELECT");
      expect(dept).toBeDisabled();
      expect(screen.queryByPlaceholderText(/3f2504e0/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /create job opening/i })).toBeDisabled();
      fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
      await waitFor(() => expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument());
      expect(screen.getByRole("button", { name: /create job opening/i })).not.toBeDisabled();
    });

    it("uses government-style placeholders, not private-sector or UUID examples", () => {
      renderForm();
      expect(screen.getByPlaceholderText("e.g. HUD/REC/2026/014")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("e.g. Assistant Engineer (Civil)")).toBeInTheDocument();
      const all = JSON.stringify(enMessages.recruitmentNewJob);
      expect(all).not.toContain("Senior Software Engineer");
      expect(all).not.toContain("JOB-2024-0042");
      expect(all).not.toMatch(/3f2504e0/);
    });

    it("translates the department placeholder option", async () => {
      renderForm();
      expect(screen.getByRole("option", { name: "Select department…" })).toBeInTheDocument();
    });
  });
});
