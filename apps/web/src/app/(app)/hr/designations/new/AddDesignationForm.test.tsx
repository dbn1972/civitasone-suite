import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AddDesignationForm } from "./AddDesignationForm";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("AddDesignationForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddDesignationForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "CLERK" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Upper Division Clerk" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "code", message: "Designation code already exists." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    expect(await screen.findByText("Designation code already exists.")).toBeInTheDocument();
  });
});

/**
 * GAP-HR-DESIGNATIONS-01: Pay Level used to accept any positive integer
 * (a level of 40 saved successfully and then rendered as an unclassifiable
 * "—" everywhere it was read back) — now bounded to the 7th CPC's real
 * range of 1-18, client-side here and matching in hrms-service's
 * createDesignationBody.
 */
describe("AddDesignationForm — GAP-HR-DESIGNATIONS-01 pay level bounded 1-18", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderForm() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddDesignationForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
  }

  it("rejects a level above 18 client-side and never calls the API", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "CLERK" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Upper Division Clerk" } });
    fireEvent.change(screen.getByLabelText(/level/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));

    expect(await screen.findByText(/between 1 and 18/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a level at the top of the real range (18)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "d1" }), { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "SEC" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Secretary" } });
    fireEvent.change(screen.getByLabelText(/level/i), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/between 1 and 18/i)).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-DESIGNATIONS-NEW-03: Pay Level and Pay Grade are optional, and a blank
 * Pay Level is stored as 0 -- shown as "—" (unclassified) everywhere it is read
 * back. The form now says so in its labels AND ties the hint to the input with
 * aria-describedby, so a screen reader announces it when the field takes focus
 * (a bare <p> sibling is only read when someone browses past it).
 */
describe("AddDesignationForm — GAP-HR-DESIGNATIONS-NEW-03 optional fields explained", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderForm() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddDesignationForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
  }

  it("labels the fields 'Pay Level (7th CPC, optional)' and 'Pay Grade (optional)'", () => {
    renderForm();
    expect(screen.getByLabelText("Pay Level (7th CPC, optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Pay Grade (optional)")).toBeInTheDocument();
  });

  it("announces the blank-means-unclassified hint as the Pay Level input's accessible description", () => {
    renderForm();
    const input = screen.getByLabelText(/pay level/i);
    expect(input).toHaveAccessibleDescription(/optional\. leave blank.*unclassified/i);
  });

  it("announces the Pay Grade hint as that input's accessible description", () => {
    renderForm();
    expect(screen.getByLabelText(/pay grade/i)).toHaveAccessibleDescription(/optional free-text reference/i);
  });

  it("keeps the hint in the description alongside a validation error", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "CLERK" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Upper Division Clerk" } });
    fireEvent.change(screen.getByLabelText(/pay level/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));

    const description = await screen.findByText(/between 1 and 18/i);
    expect(description).toBeInTheDocument();
    expect(screen.getByLabelText(/pay level/i)).toHaveAccessibleDescription(/leave blank/i);
  });

  it("saves a blank Pay Level without sending a level at all (stored as unclassified)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "d1" }), { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "CLERK" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Upper Division Clerk" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ code: "CLERK", name: "Upper Division Clerk" });
    expect(body).not.toHaveProperty("level");
  });
});
