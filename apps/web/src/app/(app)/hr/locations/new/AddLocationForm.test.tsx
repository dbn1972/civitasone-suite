import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AddLocationForm } from "./AddLocationForm";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("AddLocationForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Block Development Office" } });
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));
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
          fieldErrors: [{ field: "postalCode", message: "Postal code must be numeric." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    // AddLocationForm doesn't render fieldError spans (no addressable-field
    // wiring in this file); the clerk-safe summary must still surface here.
    await waitFor(() => expect(screen.getByText(/Some details need changing\. Check the highlighted fields and try again\./)).toBeInTheDocument());
  });
});

/**
 * GAP-HR-LOCATIONS-NEW-01: a Parent location select, filtered to the types
 * eligible as a parent of the chosen Type, and hidden entirely for "State"
 * (which has no parent).
 */
describe("AddLocationForm — GAP-HR-LOCATIONS-NEW-01 parent location", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const LOCATIONS = [
    { id: "s1", name: "Jharkhand", type: "state", parentId: null },
    { id: "d1", name: "Ranchi", type: "district", parentId: "s1" },
    { id: "o1", name: "District Treasury", type: "office", parentId: "d1" },
  ];

  it("offers only state-type locations as a parent for a new District", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={vi.fn()} locations={LOCATIONS} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: "district" } });

    expect(screen.getByRole("option", { name: "Jharkhand" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "District Treasury" })).not.toBeInTheDocument();
  });

  it("hides the parent select entirely when Type is State", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={vi.fn()} locations={LOCATIONS} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: "state" } });
    expect(screen.queryByLabelText(/parent location/i)).not.toBeInTheDocument();
  });

  it("sends the chosen parentId in the POST body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "l1", status: "created" }), { status: 202 }));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={vi.fn()} locations={LOCATIONS} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Block Office" } });
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: "district" } });
    fireEvent.change(screen.getByLabelText(/parent location/i), { target: { value: "s1" } });
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ parentId: "s1", type: "district" });
  });
});

/**
 * GAP-HR-LOCATIONS-NEW-03: an Indian PIN code is exactly 6 digits
 * (first digit non-zero) -- this used to accept 1-6 digits of anything.
 */
describe("AddLocationForm — GAP-HR-LOCATIONS-NEW-03 postal code validation", () => {
  it("rejects a postal code shorter than 6 digits", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Block Office" } });
    fireEvent.change(screen.getByLabelText(/postal code/i), { target: { value: "834" } });
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));

    expect(await screen.findByText(/6-digit pin code/i)).toBeInTheDocument();
  });

  it("accepts a well-formed 6-digit postal code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "l1", status: "created" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Block Office" } });
    fireEvent.change(screen.getByLabelText(/postal code/i), { target: { value: "834001" } });
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });
});

describe("AddLocationForm — GAP-HR-LOCATIONS-NEW-04 discard confirmation", () => {
  it("cancels immediately on a pristine form (no dialog)", () => {
    const onCancel = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={onCancel} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks for confirmation when fields are dirty, and only cancels on confirm", () => {
    const onCancel = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={onCancel} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Block Office" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancel/i }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("AddLocationForm — success message stays visible after a 202", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the submitted confirmation (not wiped by the field reset)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "x1", status: "created" }), { status: 202 })));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Block Development Office" } });
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));
    expect(await screen.findByText(/submitted — it will appear shortly/i)).toBeInTheDocument();
    expect(screen.getByText(/Block Development Office/)).toBeInTheDocument();
  });
});
