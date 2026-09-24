import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { GenerateForm16Form } from "./GenerateForm16Form";

// UX-017: GenerateForm16Form now reads its copy through next-intl
// (useTranslations("generateForm16Form")), so every render needs a real
// provider in the tree -- same pattern as pt/PtSlabForm.test.tsx (tranche 12).
function renderForm(defaultFy = "2025-26", locale: "en" | "hi" = "en") {
  const messages = locale === "hi" ? hiMessages : enMessages;
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <GenerateForm16Form defaultFy={defaultFy} />
    </NextIntlClientProvider>,
  );
}

describe("GenerateForm16Form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("requires an Employee ID in single-employee mode before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Generate Form-16" }));
    expect(screen.getByText("Employee ID is required to generate a single Form-16.")).toBeInTheDocument();
  });

  it("rejects a malformed financial year", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Financial Year/), { target: { value: "bad-fy" } });
    fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: "emp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Form-16" }));
    expect(screen.getByText(/Financial year must be in format/)).toBeInTheDocument();
  });

  it("queues single-employee generation on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { jobId: "job-42", fy: "2025-26", message: "bulk Form 16 generation queued" } }),
        { status: 202 },
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Form-16" }));

    await waitFor(() => expect(screen.getByText("Generate this employee's Form-16?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => {
      expect(screen.getByText("job-42")).toBeInTheDocument();
    });
    expect(pushMock).toHaveBeenCalledWith("/hr/payroll/form16?fy=2025-26");
  });

  it("surfaces a server error on the confirm dialog when the bulk job is already in progress (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Form-16" }));

    await waitFor(() => expect(screen.getByText("Generate this employee's Form-16?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // UX-017 bug-class regression (tranches 5/10/11/12/13, now also here): the
  // financial-year aria-invalid used to be wired off
  // `validationError?.startsWith("Financial year")` -- a hardcoded ENGLISH
  // prefix check against what is now translated display text. Rendering only
  // in English (as the last two tranches' own regression tests did) cannot
  // distinguish the real fix from a reintroduced version of the bug, because
  // the English string is unchanged before/after translation. This renders
  // hi.json specifically: under the old buggy code, the Hindi validation
  // message never starts with "Financial year", so aria-invalid would
  // silently stay unset even while a real, displayed error is showing.
  it("flags the financial-year field as aria-invalid under a non-English locale (UX-017 bug-class regression)", () => {
    renderForm("2025-26", "hi");
    const fyInput = screen.getByLabelText(/वित्तीय वर्ष/);
    const empInput = screen.getByLabelText(/कर्मचारी आईडी/);
    fireEvent.change(fyInput, { target: { value: "bad-fy" } });
    fireEvent.change(empInput, { target: { value: "emp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "फॉर्म-16 जनरेट करें" }));

    // The Hindi error text must actually be showing (proves translation
    // happened, not just that the identity fix compiles)...
    expect(screen.getByRole("alert")).toHaveTextContent("वित्तीय वर्ष YYYY-YY प्रारूप में होना चाहिए");
    // ...and the identity-based fix must still correctly flag only the FY
    // field, never the (valid) employee ID field, regardless of locale.
    expect(fyInput).toHaveAttribute("aria-invalid", "true");
    expect(empInput).not.toHaveAttribute("aria-invalid");
  });

  // UX-017 bug-class regression, new variant: MODE_LABEL/LABEL_MODE used to
  // be a hardcoded-English label<->Mode map, with Segmented's onChange
  // looking the live (now-translatable) label back up in that English-keyed
  // table. Under hi.json, Segmented hands back the Hindi label, which never
  // matched any LABEL_MODE key, so `LABEL_MODE[v] ?? "single"` always fell
  // back to "single" -- the toggle would appear completely unresponsive
  // in any non-English locale. Rendering only in English cannot catch this
  // at all, since English labels happen to already match themselves.
  it("switches from single to bulk mode via the segmented control under a non-English locale (UX-017 bug-class regression)", () => {
    renderForm("2025-26", "hi");
    expect(screen.getByLabelText(/कर्मचारी आईडी/)).toBeInTheDocument();
    const singleTab = screen.getByRole("tab", { name: "एकल कर्मचारी" });
    const bulkTab = screen.getByRole("tab", { name: "पूरा रन (थोक)" });
    expect(singleTab).toHaveAttribute("aria-selected", "true");
    expect(bulkTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(bulkTab);

    expect(bulkTab).toHaveAttribute("aria-selected", "true");
    expect(singleTab).toHaveAttribute("aria-selected", "false");
    // The employee-ID field only renders in single mode -- its disappearance
    // is the real behavioral proof that `mode` state actually changed, not
    // just that the tab's own visual "on" state toggled.
    expect(screen.queryByLabelText(/कर्मचारी आईडी/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "पूरे रन के लिए फॉर्म-16 जनरेट करें" })).toBeInTheDocument();
  });

  // `fy` used to be seeded from `defaultFy` via plain useState(), which React
  // only honors on the very first mount -- a parent re-rendering this
  // already-mounted form with a new defaultFy (e.g. a URL-driven fy changing
  // on client-side navigation) left the field stuck on whichever FY was
  // current at first mount. Fixed with a useEffect that resyncs `fy`
  // whenever the prop itself changes.
  describe("reseeds from defaultFy when the prop changes", () => {
    it("updates the FY field when defaultFy changes on an already-mounted form", () => {
      const { rerender } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <GenerateForm16Form defaultFy="2024-25" />
        </NextIntlClientProvider>,
      );
      expect(screen.getByLabelText(/Financial Year/)).toHaveValue("2024-25");

      rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <GenerateForm16Form defaultFy="2023-24" />
        </NextIntlClientProvider>,
      );

      expect(screen.getByLabelText(/Financial Year/)).toHaveValue("2023-24");
    });

    it("does not clobber the user's own edit on a re-render where defaultFy hasn't actually changed", () => {
      const { rerender } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <GenerateForm16Form defaultFy="2024-25" />
        </NextIntlClientProvider>,
      );
      fireEvent.change(screen.getByLabelText(/Financial Year/), { target: { value: "2024-25-draft" } });

      rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <GenerateForm16Form defaultFy="2024-25" />
        </NextIntlClientProvider>,
      );

      expect(screen.getByLabelText(/Financial Year/)).toHaveValue("2024-25-draft");
    });
  });
});
