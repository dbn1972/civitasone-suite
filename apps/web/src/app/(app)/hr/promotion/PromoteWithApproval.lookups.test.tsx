import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }),
}));

import { PromoteWithApproval } from "./PromoteWithApproval";

// GAP-HR-PROMOTION-05: lookups that fail are errors with a Retry -- never "No matches", never a raw-id
// input -- "Next" is held back while a required lookup is failed, 300-employee tenants are searchable,
// an employee with no designation is blocked, and a back-dated effective date gets a (non-blocking) notice.

type Emp = { id: string; employeeNo: string; name: string; department: string };
const DESIGNATIONS = [{ id: "desig-2", name: "Under Secretary", grade: "8" }];
const ME = { id: "me-1", fullName: "Meera Self", employeeNo: "E-009" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Opts {
  employees?: Emp[];
  designations?: () => Response;
  employeeSearch?: () => Response | null;
  detail?: (id: string) => Response;
}

function mockFetch(opts: Opts = {}) {
  const employees = opts.employees ?? [{ id: "emp-1", employeeNo: "E001", name: "Asha Verma", department: "Home" }];
  const searches: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/hrms/me/profile")) return Promise.resolve(json(ME));
    if (url.includes("/hrms/designations")) return Promise.resolve((opts.designations ?? (() => json({ data: DESIGNATIONS })))());
    const detail = url.match(/\/hrms\/employees\/([^/?]+)$/);
    if (detail) return Promise.resolve((opts.detail ?? ((id) => json({ id, designation: "Section Officer" })))(detail[1] as string));
    if (url.includes("/hrms/employees?")) {
      const params = new URL(url, "http://x").searchParams;
      if (params.has("ids")) return Promise.resolve(json({ data: employees.filter((e) => (params.get("ids") ?? "").split(",").includes(e.id)) }));
      const q = params.get("q") ?? "";
      searches.push(q);
      const custom = opts.employeeSearch?.();
      if (custom) return Promise.resolve(custom);
      return Promise.resolve(json({ data: employees.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())).slice(0, Number(params.get("limit") ?? 20)) }));
    }
    return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
  }) as typeof fetch);
  return { searches };
}

function renderWidget() {
  render(<NextIntlClientProvider locale="en" messages={enMessages}><PromoteWithApproval /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "+ Promotion with approval" }));
}

const field = (label: string) => screen.getByLabelText(new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
const next = () => screen.getByRole("button", { name: "Next: Approval routing →" });
async function pick(label: string, query: string, optionText: string) {
  fireEvent.change(field(label), { target: { value: query } });
  fireEvent.mouseDown(await screen.findByText(optionText));
}

describe("PromoteWithApproval lookups (GAP-HR-PROMOTION-05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("finds employee #250 of 300 by typing a name (server-side search, no limit=200 list)", async () => {
    const crowd: Emp[] = Array.from({ length: 300 }, (_, i) => ({ id: `emp-${i + 1}`, employeeNo: `E${String(i + 1).padStart(3, "0")}`, name: `Officer ${i + 1}`, department: "Home" }));
    const { searches } = mockFetch({ employees: crowd });
    renderWidget();
    await pick("Employee", "Officer 250", "Officer 250 (E250)");
    expect(searches).toContain("Officer 250");
    await waitFor(() => expect(screen.getByLabelText("Current designation (auto-filled)")).toHaveValue("Section Officer"));
  });

  it("a 500 on designations is an error with a Retry button -- not 'No matches', and no ID input", async () => {
    let calls = 0;
    mockFetch({ designations: () => (++calls === 1 ? new Response("", { status: 500 }) : json({ data: DESIGNATIONS })) });
    renderWidget();

    fireEvent.change(field("Promote to (new designation)"), { target: { value: "Under" } });
    expect(await screen.findByText("Could not load designations. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ID/)).not.toBeInTheDocument();
    // Next is held back while the required lookup is failed and nothing is selected. The picker
    // reports its failed state to the form from an effect AFTER the error text renders, so wait for it.
    await waitFor(() => expect(next()).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.mouseDown(await screen.findByText("Under Secretary"));
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("a failed employee search is an error with a Retry button, and holds Next back", async () => {
    let calls = 0;
    mockFetch({ employeeSearch: () => (++calls === 1 ? new Response("", { status: 500 }) : null) });
    renderWidget();

    fireEvent.change(field("Employee"), { target: { value: "Asha" } });
    expect(await screen.findByText(/Could not load employees/)).toBeInTheDocument();
    expect(screen.queryByText("No matching employees")).not.toBeInTheDocument();
    // The failed state reaches the form from an effect AFTER the error text renders, so wait for it.
    await waitFor(() => expect(next()).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.mouseDown(await screen.findByText("Asha Verma (E001)"));
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it("blocks Next, with a message, for an employee whose record has no resolvable designation", async () => {
    mockFetch({ detail: (id) => json({ id, designation: "—" }) });
    renderWidget();
    await pick("Employee", "Asha", "Asha Verma (E001)");
    await waitFor(() => expect(screen.getByLabelText("Current designation (auto-filled)")).toHaveValue("—"));
    await pick("Promote to (new designation)", "Under", "Under Secretary");
    fireEvent.change(field("Effective date"), { target: { value: "2026-09-01" } });
    fireEvent.click(next());

    expect(await screen.findByText(enMessages.promotionApprove.errNoDesignation)).toBeInTheDocument();
    // still on step 1
    expect(screen.queryByLabelText(/^Initiating officer/)).not.toBeInTheDocument();
  });

  it("an employee with a designation proceeds to step 2", async () => {
    mockFetch();
    renderWidget();
    await pick("Employee", "Asha", "Asha Verma (E001)");
    await waitFor(() => expect(screen.getByLabelText("Current designation (auto-filled)")).toHaveValue("Section Officer"));
    await pick("Promote to (new designation)", "Under", "Under Secretary");
    fireEvent.change(field("Effective date"), { target: { value: "2026-09-01" } });
    fireEvent.click(next());
    expect(await screen.findByLabelText(/^Initiating officer/)).toBeInTheDocument();
  });

  it("a back-dated effective date shows a non-blocking notice and still proceeds", async () => {
    mockFetch();
    renderWidget();
    await pick("Employee", "Asha", "Asha Verma (E001)");
    await waitFor(() => expect(screen.getByLabelText("Current designation (auto-filled)")).toHaveValue("Section Officer"));
    await pick("Promote to (new designation)", "Under", "Under Secretary");
    fireEvent.change(field("Effective date"), { target: { value: "2020-01-01" } });
    expect(screen.getByText(enMessages.promotionApprove.effectiveDateBackdatedNotice)).toBeInTheDocument();
    fireEvent.click(next());
    expect(await screen.findByLabelText(/^Initiating officer/)).toBeInTheDocument();
  });
});
