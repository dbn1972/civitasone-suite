import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const backMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, back: backMock, replace: vi.fn() }),
}));

import NewDomainPage from "./page";

const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValidForm() {
  fill(/Domain Name/, "example.gov.in");
  fill(/Organisation/, "Ministry of X");
  fill(/Contact Email/, "webmaster@example.gov.in");
}

// GAP2-DOMAINS-NEW-07 deliberately changes this form's contract: there is NO
// `domains` backend (no gateway registry entry, no service serving
// POST /v1/domains), so the form is now annotated "not yet available", the
// submit button is DISABLED, and the submit handler never issues the (doomed)
// fetch. The field-validation wiring (NEW-02/03/06) is unchanged and still
// reachable by submitting the form directly; the earlier NEW-01 "POST then
// route to /domains on success" behaviour is retired by NEW-07 (it could never
// actually succeed against a non-existent route) and the tests below are
// aligned to the new contract rather than deleted.
function submitForm() {
  const form = screen.getByRole("button", { name: /register/i }).closest("form")!;
  fireEvent.submit(form);
}

describe("NewDomainPage", () => {
  let spy: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockClear();
    refreshMock.mockClear();
    spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "abc" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
  });

  // GAP2-DOMAINS-NEW-07: honest "not available" treatment.
  it("shows a not-available notice and disables the Register submit", () => {
    render(<NewDomainPage />);
    expect(screen.getByText(/not yet connected to a backend service/i)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /register/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  // GAP2-DOMAINS-NEW-07 (was NEW-01): the dead POST to the non-existent
  // /api/v1/domains route is never issued, and no routing/save-failure occurs.
  it("never POSTs to the non-existent /api/v1/domains route and does not route away", () => {
    render(<NewDomainPage />);
    fillValidForm();
    submitForm();
    expect(spy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-DOMAINS-NEW-02 (validation wiring preserved)
  it("rejects example.co.in and does not POST", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.co.in");
    fill(/Organisation/, "Ministry of X");
    fill(/Contact Email/, "webmaster@example.gov.in");
    submitForm();
    expect(await screen.findByText(/valid \.gov\.in or \.nic\.in domain/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts example.gov.in (valid form clears field errors, still never POSTs)", () => {
    render(<NewDomainPage />);
    fillValidForm();
    submitForm();
    // No validation error for a valid .gov.in domain name…
    expect(screen.queryByText(/valid \.gov\.in or \.nic\.in domain/i)).not.toBeInTheDocument();
    // …and still no POST (endpoint absent).
    expect(spy).not.toHaveBeenCalled();
  });

  it("domainType nic.in with a .gov.in name shows a field error and does not POST", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.gov.in");
    fill(/Organisation/, "Ministry of X");
    fill(/Contact Email/, "webmaster@example.gov.in");
    fireEvent.change(screen.getByLabelText(/Domain Type/), { target: { value: "nic.in" } });
    submitForm();
    expect(await screen.findByText(/requires a \.nic\.in domain/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not offer the removed 'Other' domain type", () => {
    render(<NewDomainPage />);
    const select = screen.getByLabelText(/Domain Type/) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain("other");
  });

  // GAP-DOMAINS-NEW-03 (validation wiring preserved)
  it("rejects 'a@b' as email with the custom message (noValidate so it is reachable)", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.gov.in");
    fill(/Organisation/, "Ministry of X");
    fill(/Contact Email/, "a@b");
    submitForm();
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("the form has noValidate", () => {
    const { container } = render(<NewDomainPage />);
    const form = container.querySelector("form")!;
    expect(form.noValidate).toBe(true);
  });

  it("rejects a non-numeric phone", async () => {
    render(<NewDomainPage />);
    fillValidForm();
    fill(/Contact Phone/, "abc");
    submitForm();
    expect(await screen.findByText(/valid Indian phone number/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts a valid STD phone (no field error, still never POSTs)", () => {
    render(<NewDomainPage />);
    fillValidForm();
    fill(/Contact Phone/, "011-24301001");
    submitForm();
    expect(screen.queryByText(/valid Indian phone number/i)).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  // GAP-DOMAINS-NEW-06
  it("does NOT lower-case the domain name on each keystroke (caret bug)", () => {
    render(<NewDomainPage />);
    const input = screen.getByLabelText(/Domain Name/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABC" } });
    expect(input.value).toBe("ABC");
  });

  it("lower-cases and trims the domain name on blur", () => {
    render(<NewDomainPage />);
    const input = screen.getByLabelText(/Domain Name/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Example.GOV.in  " } });
    fireEvent.blur(input);
    expect(input.value).toBe("example.gov.in");
  });

  // GAP-DOMAINS-NEW-04
  it("source contains no hard-coded hex colours", () => {
    const hex = SOURCE.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex).toEqual([]);
  });

  // GAP-DOMAINS-NEW-05
  it("shows a DPDP purpose/consent notice for the contact data", () => {
    render(<NewDomainPage />);
    expect(screen.getByText(/collected only to reach the domain owner/i)).toBeInTheDocument();
  });
});
