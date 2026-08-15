import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
