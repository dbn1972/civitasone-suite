import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import RegisterGrievancePage from "./page";

// ── router mock ──────────────────────────────────────────────────────────────
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// ── ds mock (PageHeader not relevant to consent logic) ───────────────────────
vi.mock("../../../../_components/ds", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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

    const checkbox = screen.getByRole("checkbox");
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

    fireEvent.click(screen.getByRole("checkbox"));
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

  it("calls fetch and redirects on successful submission with consent", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });

    render(<RegisterGrievancePage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: /register grievance/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/proxy/v1/citizen/grievances",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(mockPush).toHaveBeenCalledWith("/citizen/grievances");
  });

  it("displays retention and sharing notice in the consent panel", () => {
    render(<RegisterGrievancePage />);
    expect(screen.getByText(/180 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Section 4\(a\)/i)).toBeInTheDocument();
    expect(screen.getByText(/withdraw consent/i)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("checkbox"));
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
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /register grievance/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
  });
});
