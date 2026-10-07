import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CreateIndentForm } from "./CreateIndentForm";

const MODE_BANDS_URL = "/api/proxy/v1/procurement/gfr/mode-bands";
const INDENTS_URL = "/api/proxy/v1/procurement/indents";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Route fetch by URL: the create form now derives the estimated value from the
 * line items and looks up the GFR mode band whenever that total is > 0, so a
 * priced line triggers a mode-bands GET in addition to the POST. Tests must
 * distinguish the two. `postResponse` controls what the POST returns.
 */
function mockFetch(postResponse: () => Response) {
  const bands = [{ id: "DP", name: "Direct Purchase", notes: "x", requiresTender: false }];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith(MODE_BANDS_URL)) {
      return Promise.resolve(jsonResponse({ data: bands, applicableMode: "DP" }));
    }
    return Promise.resolve(postResponse());
  });
  return spy;
}

/** The POST calls only (mode-bands GETs filtered out). */
function postCalls(spy: { mock: { calls: unknown[] } }) {
  return (spy.mock.calls as [RequestInfo | URL, RequestInit?][]).filter(([input]) => {
    const url = typeof input === "string" ? input : input!.toString();
    return url === INDENTS_URL;
  });
}

async function fillOneLineItem() {
  fireEvent.change(await screen.findByLabelText("Item code, row 1"), { target: { value: "PEN-001" } });
  fireEvent.change(screen.getByLabelText("Description, row 1"), { target: { value: "Ball pens" } });
  fireEvent.change(screen.getByLabelText("Unit price, row 1"), { target: { value: "10" } });
}

describe("CreateIndentForm — purpose is required and actually sent (regression)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("blocks submit and never calls the API when purpose is empty", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => {
      expect(screen.getByText(/Enter a purpose of at least 3 characters/i)).toBeInTheDocument();
    });
    expect(postCalls(spy)).toHaveLength(0);
  });

  it("sends the typed text as `purpose` in the request body, not `remarks`", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish office stationery for Q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(postCalls(spy)).toHaveLength(1));
    const [, init] = postCalls(spy)[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.purpose).toBe("Replenish office stationery for Q3");
    expect(body).not.toHaveProperty("remarks");
  });

  it("shows a clerk-safe message, not raw server JSON, when the API call fails", async () => {
    mockFetch(() => jsonResponse({ code: "VALIDATION_FAILED", message: "invalid request", fieldErrors: [] }, 400));
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish office stationery for Q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    const alert = await screen.findByText(/Some details weren't accepted/);
    expect(alert.textContent).not.toMatch(/VALIDATION_FAILED/);
  });

  // UX-003: never show a raw HTTP status code or raw server error text, even
  // for a non-JSON / plain-text failure body.
  it("never surfaces a raw status code or raw server text on a plain-text 500", async () => {
    mockFetch(() => new Response("Internal Server Error\n at Object.<anonymous> (/srv/indent.js:12:3)", {
      status: 500,
      headers: { "content-type": "text/plain" },
    }));
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish office stationery for Q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
  });

  it("renders inline field-level messages from a fieldErrors response", async () => {
    mockFetch(() => jsonResponse({ code: "VALIDATION_FAILED", message: "validation_failed", fieldErrors: [{ field: "department", message: "Department must be a recognised office code." }] }, 400));
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish office stationery for Q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(await screen.findByText("Department must be a recognised office code.")).toBeInTheDocument();
  });
});



describe("CreateIndentForm: unit price 0 asks for confirmation", () => {
  beforeEach(() => vi.restoreAllMocks());

  async function fillUnpriced() {
    fireEvent.change(await screen.findByLabelText("Item code, row 1"), { target: { value: "PEN-001" } });
    fireEvent.change(screen.getByLabelText("Description, row 1"), { target: { value: "Ball pens" } });
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish stock" } });
  }

  it("warns on the first submit without calling the API, and submits on the second", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    await fillUnpriced();
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no unit price/i));
    expect(postCalls(spy)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(postCalls(spy)).toHaveLength(1));
  });

  it("editing a line after the warning asks again", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    await fillUnpriced();
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Description, row 1"), { target: { value: "Ball pens blue" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no unit price/i));
    expect(postCalls(spy)).toHaveLength(0);
  });

  it("a priced line submits straight away", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    await fillUnpriced();
    fireEvent.change(screen.getByLabelText("Unit price, row 1"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(postCalls(spy)).toHaveLength(1));
  });

  it("shows a note when the prefill was truncated", () => {
    mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm initialItem={{ itemCode: "A", description: "d", quantity: 1, unitPrice: 0, unit: "nos" }} prefillTruncated />);
    expect(screen.getByRole("note")).toHaveTextContent(/shortened/i);
  });
});

describe("CreateIndentForm — NEW-01/02/04/05 gap fixes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("NEW-01: department starts empty and an empty department blocks submit with a field error", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    expect((screen.getByLabelText("Department *") as HTMLInputElement).value).toBe("");
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish stock" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(screen.getByText(/Choose the department/i)).toBeInTheDocument());
    expect(postCalls(spy)).toHaveLength(0);
  });

  it("NEW-04: does not send a client-generated indentNo, and the field reads 'Assigned on submit'", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    expect((screen.getByLabelText("Indent No") as HTMLInputElement).value).toBe("Assigned on submit");
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish stock" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(postCalls(spy)).toHaveLength(1));
    const body = JSON.parse((postCalls(spy)[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("indentNo");
  });

  it("NEW-04: posts the clerk-chosen unit per line, not a hard-coded 'nos'", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Unit, row 1"), { target: { value: "kg" } });
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish stock" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(postCalls(spy)).toHaveLength(1));
    const body = JSON.parse((postCalls(spy)[0][1] as RequestInit).body as string);
    expect(body.items[0].unit).toBe("kg");
  });

  it("NEW-02: estimatedValueMinor is derived from the line items (2 lines of 1,25,000 each -> 25000000)", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    fireEvent.change(await screen.findByLabelText("Item code, row 1"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Description, row 1"), { target: { value: "Line A" } });
    fireEvent.change(screen.getByLabelText("Quantity, row 1"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Unit price, row 1"), { target: { value: "250000" } });
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Capital purchase" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(postCalls(spy)).toHaveLength(1));
    const body = JSON.parse((postCalls(spy)[0][1] as RequestInit).body as string);
    expect(body.estimatedValueMinor).toBe(25000000);
  });

  it("NEW-05: a required-by date before the indent date blocks submit with a field error", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    await fillOneLineItem();
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: "IT" } });
    fireEvent.change(screen.getByLabelText("Purpose / justification *"), { target: { value: "Replenish stock" } });
    // indentDate defaults to today; set requiredBy clearly before it.
    fireEvent.change(screen.getByLabelText("Indent date *"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("Required by date"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(screen.getByText(/cannot be before the indent date/i)).toBeInTheDocument());
    expect(postCalls(spy)).toHaveLength(0);
  });
});

describe("CreateIndentForm — NEW-03 mode-lookup failure is explicit", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows an error + retry (not a perpetual 'Determining mode…') when the lookup fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith(MODE_BANDS_URL)) return Promise.resolve(new Response("boom", { status: 500 }));
      return Promise.resolve(jsonResponse({ id: "x", status: "accepted" }, 202));
    });
    render(<CreateIndentForm />);
    fireEvent.change(await screen.findByLabelText("Item code, row 1"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Description, row 1"), { target: { value: "Line A" } });
    fireEvent.change(screen.getByLabelText("Unit price, row 1"), { target: { value: "500" } });
    await waitFor(() => {
      expect(screen.getByText(/tender-requirement check did not run/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Determining mode…/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the mode band on a successful lookup", async () => {
    mockFetch(() => jsonResponse({ id: "x", status: "accepted" }, 202));
    render(<CreateIndentForm />);
    fireEvent.change(await screen.findByLabelText("Item code, row 1"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Description, row 1"), { target: { value: "Line A" } });
    fireEvent.change(screen.getByLabelText("Unit price, row 1"), { target: { value: "500" } });
    await waitFor(() => expect(screen.getByText(/Direct Purchase/)).toBeInTheDocument());
  });
});
