import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { CreateTenderForm } from "./CreateTenderForm";

const INDENT = { id: "ind-1", indentNo: "IND-1", department: "IT", status: "approved" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Route the mount fetches (indents + gfr bands) and the POST.
function wireFetch(postImpl?: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/procurement/indents")) return Promise.resolve(jsonResponse({ data: [INDENT] }));
    if (url.includes("/gfr/mode-bands")) {
      return Promise.resolve(jsonResponse({ data: [{ id: "LTR", name: "Limited Tender Request", notes: "x", requiresTender: true }], applicableMode: "LTR" }));
    }
    if (url.includes("/procurement/tenders") && init?.method === "POST") {
      return Promise.resolve(postImpl ? postImpl() : jsonResponse({ id: "new-tender" }, 202));
    }
    return Promise.resolve(jsonResponse({ data: [] }));
  });
}

async function fillValid() {
  await waitFor(() => expect(screen.getByRole("option", { name: /IND-1/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Tender title *"), { target: { value: "Supply of laptops" } });
  fireEvent.change(screen.getByLabelText("Source indent *"), { target: { value: "ind-1" } });
  fireEvent.change(screen.getByLabelText("Estimated value (₹) *"), { target: { value: "400000" } });
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  fireEvent.change(screen.getByLabelText("Bid closing date *"), { target: { value: future } });
}

describe("CreateTenderForm (GAP-PROCUREMENT-TENDERS-NEW-01/02/03/04/05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("NEW-01: a tender without a source indent is rejected client-side", async () => {
    wireFetch();
    render(<CreateTenderForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: /IND-1/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Tender title *"), { target: { value: "No indent" } });
    fireEvent.change(screen.getByLabelText("Estimated value (₹) *"), { target: { value: "400000" } });
    fireEvent.change(screen.getByLabelText("Bid closing date *"), { target: { value: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) } });
    fireEvent.click(screen.getByRole("button", { name: "Save tender" }));
    expect(await screen.findByText(/Choose the source indent/)).toBeInTheDocument();
  });

  it("NEW-03: estimated value of 0 is rejected", async () => {
    wireFetch();
    render(<CreateTenderForm />);
    await fillValid();
    fireEvent.change(screen.getByLabelText("Estimated value (₹) *"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tender" }));
    expect(await screen.findByText(/greater than ₹0/)).toBeInTheDocument();
  });

  it("NEW-03: a past bid closing date is rejected", async () => {
    wireFetch();
    render(<CreateTenderForm />);
    await fillValid();
    fireEvent.change(screen.getByLabelText("Bid closing date *"), { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tender" }));
    expect(await screen.findByText(/cannot be in the past/)).toBeInTheDocument();
  });

  it("NEW-02: selecting Single Source without justification blocks submit", async () => {
    wireFetch();
    render(<CreateTenderForm />);
    await fillValid();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "single_source" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tender" }));
    expect(await screen.findByText(/justification category/)).toBeInTheDocument();
  });

  it("NEW-01/02/03/04: a valid submit posts indentRef + exact paise and saves as draft", async () => {
    const spy = wireFetch();
    render(<CreateTenderForm />);
    await fillValid();
    fireEvent.change(screen.getByLabelText("Estimated value (₹) *"), { target: { value: "1234.56" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tender" }));

    await waitFor(() => expect(screen.getByText(/saved as draft/)).toBeInTheDocument());
    const post = spy.mock.calls.find(([u, i]) => String(u).includes("/procurement/tenders") && (i as RequestInit)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.indentRef).toBe("procurement_indent:ind-1");
    expect(body.estimatedMinor).toBe(123456); // 1234.56 -> exact paise, no float drift
  });

  it("NEW-05: the Scope and Eligibility textareas enforce a max length", async () => {
    wireFetch();
    render(<CreateTenderForm />);
    await waitFor(() => expect(screen.getByLabelText("Tender title *")).toBeInTheDocument());
    expect(screen.getByLabelText("Scope of work")).toHaveAttribute("maxLength", "4000");
    expect(screen.getByLabelText("Eligibility criteria")).toHaveAttribute("maxLength", "4000");
  });
});
