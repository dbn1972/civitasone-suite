import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import enMessages from "@/messages/en.json";
import RegisterGrievancePage from "./page";

// ── router mock ──────────────────────────────────────────────────────────────
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// ── ds mock (PageHeader not relevant to consent logic) ───────────────────────
// UX-008 tranche 13: page.tsx's submit button now renders via the shared ds
// Button, so this mock of the ds barrel must provide one too (matching the
// tranche 3/4/6-established incomplete-ds-barrel-mock fix) -- otherwise
// Button resolves to undefined and every render throws. Plain passthrough:
// role/name/disabled all reach a real button element, which is all this suite's
// getByRole("button", ...) / toBeDisabled() checks need.
vi.mock("../../../../_components/ds", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Button: ({ children, ...rest }: ComponentProps<"button">) => (
    <button {...rest}>{children}</button>
  ),
}));

// UX-017: the form now reads next-intl's useTranslations() for every label —
// every render here needs the same NextIntlClientProvider the real root
// layout supplies (same convention as AccountMenu.test.tsx / LanguageSwitcher.test.tsx).
function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** Fill the required text fields so the form passes field-presence validation. */
function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/applicant name/i), {
    target: { value: "Ramesh Kumar" },
  });
  fireEvent.change(screen.getByLabelText(/subject/i), {
    target: { value: "Water supply disruption" },
  });
  fireEvent.change(screen.getByLabelText(/description/i), {
    target: { value: "No water supply for 5 days in Ward 12." },
  });
}

describe("RegisterGrievancePage — DPDP 2023 consent gate", () => {
  it("renders the DPDP consent notice with aria-required checkbox", () => {
    render(<RegisterGrievancePage />);
    expect(screen.getByText(/Data Protection Notice — DPDP Act 2023/i)).toBeInTheDocument();
    // The notice panel and the label both mention "DPDP Act 2023"; confirm at least one instance.
    expect(screen.getAllByText(/DPDP Act 2023/i).length).toBeGreaterThanOrEqual(1);

    const checkbox = (document.getElementById("dpdp-consent") as HTMLInputElement);
    expect(checkbox).toHaveAttribute("aria-required", "true");
    expect(checkbox).not.toBeChecked();
  });

  it("disables the submit button when consent is not given", () => {
    render(<RegisterGrievancePage />);
    const submitBtn = screen.getByRole("button", { name: /register grievance/i });
    expect(submitBtn).toBeDisabled();
  });

  it("enables the submit button only after consent checkbox is checked", () => {
    render(<RegisterGrievancePage />);
    const submitBtn = screen.getByRole("button", { name: /register grievance/i });
    expect(submitBtn).toBeDisabled();

    fireEvent.click((document.getElementById("dpdp-consent") as HTMLInputElement));
    expect(submitBtn).not.toBeDisabled();
  });

  it("does not call fetch when all fields filled but consent not given", async () => {
    render(<RegisterGrievancePage />);
    fillRequiredFields();

    // Attempt submit without checking the consent box.
    // The button is disabled so we fire a form submit event directly.
    const form = screen.getByRole("button", { name: /register grievance/i }).closest("form")!;
    fireEvent.submit(form);

    // Fetch must never be called — consent gate must block the request.
    await waitFor(() =>
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/proxy/v1/citizen/grievances",
        expect.anything(),
      ),
    );
  });

  it("shows an error message when form is submitted without consent via programmatic submit", async () => {
    render(<RegisterGrievancePage />);
    fillRequiredFields();

    const form = screen.getByRole("button", { name: /register grievance/i }).closest("form")!;
    fireEvent.submit(form);

    expect(
      await screen.findByText(/consent to data processing under DPDP Act 2023/i),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the grievance number acknowledgement (not an immediate redirect) on successful submission with consent", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "11111111-2222-4333-8444-555555555555", grievanceNo: "CPG-2026-0001" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<RegisterGrievancePage />);
    fillRequiredFields();
    fireEvent.click((document.getElementById("dpdp-consent") as HTMLInputElement));

    fireEvent.click(screen.getByRole("button", { name: /register grievance/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/proxy/v1/citizen/grievances",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // GAP-CITIZEN-GRIEVANCES-NEW-03: the citizen sees a quotable grievance
    // number before leaving the page — no immediate redirect.
    expect(await screen.findByText("CPG-2026-0001")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalledWith("/citizen/grievances");
  });

  it("sends a structured DPDP consent object and contact in the POST body (GAP-CITIZEN-GRIEVANCES-NEW-01/02/04)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "abc", grievanceNo: "GRV-ABC" }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<RegisterGrievancePage />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/contact mobile/i), { target: { value: "9876543210" } });
    fireEvent.click((document.getElementById("dpdp-consent") as HTMLInputElement));
    fireEvent.click(screen.getByRole("button", { name: /register grievance/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.dpdpConsent).toEqual({ given: true, noticeVersion: "2023.1", purpose: "grievance_redressal" });
    expect(sent.complainantContact).toEqual([{ kind: "mobile", value: "9876543210" }]);
  });

  it("displays retention and sharing notice in the consent panel", () => {
    render(<RegisterGrievancePage />);
    expect(screen.getByText(/180 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Section 4\(a\)/i)).toBeInTheDocument();
    expect(screen.getByText(/withdraw consent/i)).toBeInTheDocument();
  });

  // GAP-CITIZEN-GRIEVANCES-NEW-02 — filing on behalf of a citizen
  it("sends filedOnBehalf=true and requires a contact when filing on behalf of a citizen", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "ob1", grievanceNo: "GRV-OB1" }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<RegisterGrievancePage />);
    fillRequiredFields();
    // Enter on-behalf mode and consent.
    fireEvent.click(screen.getByLabelText(/on behalf of a citizen/i));
    fireEvent.click((document.getElementById("dpdp-consent") as HTMLInputElement));

    // Submitting with no contact is blocked with a clear message.
    fireEvent.click(screen.getByRole("button", { name: /register grievance/i }));
    expect(await screen.findByText(/so the complainant can be contacted/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // Add a contact and submit — now filedOnBehalf travels in the body.
    fireEvent.change(screen.getByLabelText(/contact mobile/i), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: /register grievance/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.filedOnBehalf).toBe(true);
    expect(sent.complainantContact).toEqual([{ kind: "mobile", value: "9876543210" }]);
  });
});

describe("RegisterGrievancePage — server error handling (UX-003)", () => {
  it("renders inline field-level messages from a fieldErrors response, not just a raw error string", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "subject", message: "Subject must be under 200 characters." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    render(<RegisterGrievancePage />);
    fillRequiredFields();
    fireEvent.click((document.getElementById("dpdp-consent") as HTMLInputElement));
    fireEvent.click(screen.getByRole("button", { name: /register grievance/i }));

    expect(await screen.findByText("Subject must be under 200 characters.")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("never surfaces a raw status code or raw server text on failure", async () => {
    fetchMock.mockResolvedValue(
      new Response("Internal Server Error\n at Object.<anonymous> (/srv/grievance.js:9:1)", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    render(<RegisterGrievancePage />);
    fillRequiredFields();
    fireEvent.click((document.getElementById("dpdp-consent") as HTMLInputElement));
    fireEvent.click(screen.getByRole("button", { name: /register grievance/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
  });
});
