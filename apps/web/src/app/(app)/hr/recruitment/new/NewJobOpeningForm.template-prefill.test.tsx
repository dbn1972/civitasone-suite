import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// MEDIUM finding: JD-template linkage. Separate file from
// NewJobOpeningForm.test.tsx because that file's useSearchParams mock is
// fixed at `get: () => null` for its whole suite (every one of its tests
// relies on the template-prefill effect being a no-op) -- this needs its
// own mock returning a real templateId instead, which module-level vi.mock
// can't vary per-test within the same file.
const TEMPLATE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => (key === "templateId" ? TEMPLATE_ID : null) }),
}));

import { NewJobOpeningForm } from "./NewJobOpeningForm";

const TEMPLATE_RESPONSE = {
  name: "Section Officer (Finance) — Template",
  vacancyType: "regular",
  description: "Handles finance section casework.",
  qualification: "B.Com / M.Com with 3+ years experience",
  payRange: "Level 10, Rs 56,100 - 1,77,500",
  selectionProcess: "Written test, then interview, then document verification",
  requiredDocuments: ["Aadhaar", "Degree Certificate", "Caste Certificate"],
  eligibility: { minAge: 21, maxAge: 35 },
};

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewJobOpeningForm />
    </NextIntlClientProvider>,
  );
}

function mockFetchForTemplateFlow() {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/proxy/v1/hrms/jd-templates/${TEMPLATE_ID}`) {
      return { ok: true, status: 200, json: async () => TEMPLATE_RESPONSE, text: async () => JSON.stringify(TEMPLATE_RESPONSE) } as Response;
    }
    if (url === "/api/proxy/v1/hrms/job-openings" && init?.method === "POST") {
      return { ok: true, status: 202, text: async () => "{}" } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("NewJobOpeningForm — template pre-fill (MEDIUM finding)", () => {
  beforeEach(() => {
    mockFetchForTemplateFlow();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pre-fills qualification/payRange/selectionProcess from the fetched template, not just title/vacancyType/description", async () => {
    renderForm();

    await waitFor(() => {
      expect(screen.getByLabelText(/qualification/i)).toHaveValue(TEMPLATE_RESPONSE.qualification);
    });
    expect(screen.getByLabelText(/pay range/i)).toHaveValue(TEMPLATE_RESPONSE.payRange);
    expect(screen.getByLabelText(/selection process/i)).toHaveValue(TEMPLATE_RESPONSE.selectionProcess);
    expect(screen.getByDisplayValue(TEMPLATE_RESPONSE.name)).toBeInTheDocument(); // title, pre-existing behavior unchanged
  });

  it("sends templateId, and the template's full field set, on submit — not silently dropped", async () => {
    const fetchMock = mockFetchForTemplateFlow();
    renderForm();

    await waitFor(() => {
      expect(screen.getByLabelText(/qualification/i)).toHaveValue(TEMPLATE_RESPONSE.qualification);
    });

    fireEvent.change(screen.getByLabelText(/reference no/i), { target: { value: "JOB-2027-0099" } });
    fireEvent.change(screen.getByLabelText(/department id/i), { target: { value: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" } });
    fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/submitted/i);
    });

    const postCall = fetchMock.mock.calls.find(([url, init]) => url === "/api/proxy/v1/hrms/job-openings" && (init as RequestInit)?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.templateId).toBe(TEMPLATE_ID);
    expect(body.qualification).toBe(TEMPLATE_RESPONSE.qualification);
    expect(body.payRange).toBe(TEMPLATE_RESPONSE.payRange);
    expect(body.selectionProcess).toBe(TEMPLATE_RESPONSE.selectionProcess);
    expect(body.requiredDocuments).toEqual(TEMPLATE_RESPONSE.requiredDocuments);
    expect(body.eligibility).toEqual(TEMPLATE_RESPONSE.eligibility);
  });

  it("HR can still override a pre-filled field before saving", async () => {
    renderForm();

    await waitFor(() => {
      expect(screen.getByLabelText(/qualification/i)).toHaveValue(TEMPLATE_RESPONSE.qualification);
    });
    fireEvent.change(screen.getByLabelText(/qualification/i), { target: { value: "Overridden qualification" } });
    expect(screen.getByLabelText(/qualification/i)).toHaveValue("Overridden qualification");
  });
});
