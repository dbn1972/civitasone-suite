import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { Form16Wizard } from "./Form16Wizard";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}));

// UX-017: Form16Wizard now reads its copy through next-intl
// (useTranslations("form16Wizard")), so every render needs a real provider
// in the tree -- same pattern as pt/PtSlabForm.test.tsx (tranche 12).
function renderWizard(defaultFy = "2025-26") {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Form16Wizard defaultFy={defaultFy} />
    </NextIntlClientProvider>,
  );
}

describe("Form16Wizard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    replaceMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("advances from step 0 to step 1 and back via Next/Back when the FY is unchanged", () => {
    renderWizard();
    expect(screen.getByText("Financial Year")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    expect(screen.getByText("All employees")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByText("Financial Year")).toBeInTheDocument();
  });

  // GAP-PAYROLL-FORM16-07: the wizard's own FY field used to be completely
  // independent of the URL/status-card FY. Changing it now syncs the URL
  // (which, on the real page, remounts the wizard via key={fy} -- not
  // re-testable in isolation here, see page.test.tsx) instead of silently
  // drifting from what the rest of the page shows.
  it("syncs a changed FY to the URL via router.replace instead of advancing in place", () => {
    renderWizard("2025-26");
    fireEvent.change(screen.getByLabelText("Financial Year"), { target: { value: "2026-27" } });
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    expect(replaceMock).toHaveBeenCalledWith("?fy=2026-27");
    // Still on step 0 in THIS instance -- the real remount happens one level up.
    expect(screen.getByText("Financial Year")).toBeInTheDocument();
  });

  it("blocks Next and shows an error on a malformed FY", () => {
    renderWizard("2025-26");
    fireEvent.change(screen.getByLabelText("Financial Year"), { target: { value: "2025-99" } });
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    expect(screen.getByText(/Enter a valid financial year/)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByText("Financial Year")).toBeInTheDocument();
  });

  // GAP-PAYROLL-FORM16-02: no fabricated challan reference string anywhere.
  it("shows the TDS reconciliation table without a fabricated challan reference", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    expect(screen.queryByText(/CHLN-/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  });

  // GAP-PAYROLL-FORM16-03: blank-id-means-all is gone -- scope is explicit,
  // and a confirmation names it before the POST ever fires.
  it("defaults to All employees scope and requires confirmation before generating", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { jobId: "job-123" } }), { status: 200 }),
    );
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    expect(screen.getByLabelText("All employees")).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /Generate Form 16/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Generate Form 16?")).toBeInTheDocument();
    expect(screen.getByText(/every employee/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ fy: "2025-26" });
  });

  it("requires picking an employee for the One employee scope before the confirm dialog can submit", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    fireEvent.click(screen.getByLabelText("One employee"));
    expect(screen.getByPlaceholderText(/Type a name or employee code/)).toBeInTheDocument();
  });

  // GAP-PAYROLL-FORM16-04: the download link must not appear the instant
  // the job is queued -- only once polling reports the job completed.
  it("polls bulk-status and only shows the download link once the job is completed", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: "job-123" } }), { status: 200 })) // bulk-generate
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "processing" } }), { status: 200 })); // first poll

    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Form 16/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByText("Form-16 generation in progress")).toBeInTheDocument());
    expect(screen.queryByText("⬇ Download Form 16 ZIP")).not.toBeInTheDocument();
  });

  it("shows the download link once a poll reports the job completed", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: "job-123" } }), { status: 200 })) // bulk-generate
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "completed" } }), { status: 200 })); // first poll, already done

    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Form 16/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByText("Form-16 generation complete")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Download Form 16 ZIP/ })).toBeInTheDocument();
  });

  it("shows an error and stays on step 1 when generation fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "FY not closed yet." } }), { status: 422 }),
    );
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Form 16/ }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("FY not closed yet."));
    expect(screen.getByText("All employees")).toBeInTheDocument();
  });

  describe("step-change focus management and announcement", () => {
    it("does not steal focus on initial mount", () => {
      renderWizard();
      expect(document.activeElement).not.toHaveAttribute("role", "group");
    });

    it("moves focus to the new step's panel when Next is clicked", () => {
      renderWizard();
      fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
      const panel = screen.getByRole("group", { name: "Review" });
      expect(document.activeElement).toBe(panel);
      expect(panel).toHaveAttribute("tabindex", "-1");
    });

    it("moves focus back to step 0's panel when Back is clicked", () => {
      renderWizard();
      fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
      fireEvent.click(screen.getByRole("button", { name: "← Back" }));
      expect(document.activeElement).toBe(screen.getByRole("group", { name: "Select FY" }));
    });

    it("announces the new step via a polite live region", () => {
      renderWizard();
      fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
      const live = document.querySelector('[aria-live="polite"]');
      expect(live).not.toBeNull();
      expect(live).toHaveTextContent("Step 2 of 3: Review");
    });
  });

  describe("resets when the URL-driven FY changes (key-remount, matching page.tsx)", () => {
    it("reseeds the FY field and returns to step 0 on a fy-keyed remount", () => {
      const { rerender } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <Form16Wizard key="2024-25" defaultFy="2024-25" />
        </NextIntlClientProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
      expect(screen.getByText("All employees")).toBeInTheDocument();

      rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <Form16Wizard key="2023-24" defaultFy="2023-24" />
        </NextIntlClientProvider>,
      );

      expect(screen.getByText("Financial Year")).toBeInTheDocument();
      expect(screen.getByLabelText("Financial Year")).toHaveValue("2023-24");
    });

    it("without a changing key, defaultFy alone does NOT update an already-mounted wizard (documents why the key is required)", () => {
      const { rerender } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <Form16Wizard defaultFy="2024-25" />
        </NextIntlClientProvider>,
      );
      rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <Form16Wizard defaultFy="2023-24" />
        </NextIntlClientProvider>,
      );
      expect(screen.getByLabelText("Financial Year")).toHaveValue("2024-25");
    });
  });
});
