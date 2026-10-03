import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: () => null }) }));

import { NewJobOpeningForm } from "./NewJobOpeningForm";
import { fetchRequisitionRequired, isRequisitionRequiredResponse } from "./requisitionPolicy";

const DEPT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const POLICY_URL = "/api/proxy/v1/hrms/recruitment-policy";
const POST_URL = "/api/proxy/v1/hrms/job-openings";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stub(policy: () => Response, post: () => Response = () => new Response("{}", { status: 202 })) {
  const fn = vi.fn(async (url: string) => {
    if (url === POLICY_URL) return policy();
    if (url.includes("/departments")) return json({ data: [{ id: DEPT_ID, name: "Finance" }] });
    if (url.includes("/designations")) return json({ data: [] });
    if (url.includes("/pay-matrix")) return json({ data: [] });
    if (url === POST_URL) return post();
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const renderForm = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><NewJobOpeningForm /></NextIntlClientProvider>);
const submitBtn = () => screen.getByRole("button", { name: /create job opening/i });

async function fill() {
  fireEvent.change(screen.getByLabelText(/reference no/i), { target: { value: "JOB-1" } });
  fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Junior Engineer" } });
  await waitFor(() => expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/^department/i), { target: { value: DEPT_ID } });
}

describe("NewJobOpeningForm -- requisition-first editions (GAP-RECRUITMENT-NEW-06)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a Govt-edition policy shows the notice (with a link to requisitions) and disables Create", async () => {
    stub(() => json({ edition: "govt", requireRequisition: null, requisitionRequired: true }));
    renderForm();
    expect(await screen.findByText("This vacancy must come from an approved requisition")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to requisitions" })).toHaveAttribute("href", "/hr/recruitment/requisitions");
    expect(submitBtn()).toBeDisabled();
  });

  it("a Small-Office policy shows no notice and Create stays enabled", async () => {
    stub(() => json({ edition: "small_office", requireRequisition: null, requisitionRequired: false }));
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument());
    expect(screen.queryByText("This vacancy must come from an approved requisition")).not.toBeInTheDocument();
    expect(submitBtn()).toBeEnabled();
  });

  it("if the policy cannot be read the form stays usable, and the server's 409 REQUISITION_REQUIRED then swaps in the notice", async () => {
    stub(() => json({}, 500), () => json({ code: "REQUISITION_REQUIRED", message: "x" }, 409));
    renderForm();
    await fill();
    fireEvent.click(submitBtn());
    expect(await screen.findByText("This vacancy must come from an approved requisition")).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });
});

describe("requisitionPolicy helpers", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fetchRequisitionRequired is true only for an explicit true", async () => {
    stub(() => json({ requisitionRequired: true }));
    expect(await fetchRequisitionRequired()).toBe(true);
    stub(() => json({ requisitionRequired: "yes" }));
    expect(await fetchRequisitionRequired()).toBe(false);
    stub(() => json({}, 403));
    expect(await fetchRequisitionRequired()).toBe(false);
  });
  it("isRequisitionRequiredResponse needs both 409 and the code", async () => {
    expect(await isRequisitionRequiredResponse(json({ code: "REQUISITION_REQUIRED" }, 409))).toBe(true);
    expect(await isRequisitionRequiredResponse(json({ code: "VERSION_CONFLICT" }, 409))).toBe(false);
    expect(await isRequisitionRequiredResponse(json({ code: "REQUISITION_REQUIRED" }, 400))).toBe(false);
    expect(await isRequisitionRequiredResponse(new Response("not json", { status: 409 }))).toBe(false);
  });
});
