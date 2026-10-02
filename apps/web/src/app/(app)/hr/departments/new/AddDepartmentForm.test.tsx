import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AddDepartmentForm } from "./AddDepartmentForm";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("AddDepartmentForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddDepartmentForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "FIN" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Finance Department" } });
    fireEvent.click(screen.getByRole("button", { name: /add department/i }));
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
          fieldErrors: [{ field: "code", message: "Department code already exists." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    expect(await screen.findByText("Department code already exists.")).toBeInTheDocument();
  });

  /**
   * GAP-HR-DEPARTMENTS-NEW-02: a duplicate code now 409s synchronously
   * (masters-routes.ts); the field error renders under Code exactly like the
   * VALIDATION_FAILED case above.
   */
  it("renders a DUPLICATE_CODE field error under Code without redirecting", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "DUPLICATE_CODE",
          message: 'Department code "FIN" already exists.',
          fieldErrors: [{ field: "code", message: "This code is already in use." }],
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    expect(await screen.findByText("This code is already in use.")).toBeInTheDocument();
  });

  /**
   * GAP-HR-DEPARTMENTS-NEW-01: a stale/removed parent now 400s with a field
   * error under the Parent select (masters-routes.ts's PARENT_NOT_FOUND),
   * instead of only a generic top-of-form message.
   */
  it("renders a PARENT_NOT_FOUND field error under Parent department", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "PARENT_NOT_FOUND",
          message: "Selected parent department does not exist.",
          fieldErrors: [{ field: "parentId", message: "Selected parent department does not exist." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    expect(await screen.findByText("Selected parent department does not exist.")).toBeInTheDocument();
  });
});

describe("AddDepartmentForm — GAP-HR-DEPARTMENTS-NEW-01 Type/Govt tier/Head fields", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders Type, Govt tier and Head controls, and sends what was filled in", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "d1", status: "created" }), { status: 202 }));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddDepartmentForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "FIN" } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Finance Department" } });
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: "Directorate" } });
    fireEvent.change(screen.getByLabelText(/govt tier/i), { target: { value: "state" } });
    fireEvent.click(screen.getByRole("button", { name: /add department/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "FIN", name: "Finance Department", type: "Directorate", govtTier: "state" });
    // Head was never chosen -- must not send a falsy/placeholder id.
    expect(body).not.toHaveProperty("headEmployeeId");
  });
});

describe("AddDepartmentForm — GAP-HR-DEPARTMENTS-NEW-04 discard confirmation", () => {
  it("cancels immediately on a pristine form (no dialog)", () => {
    const onCancel = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddDepartmentForm onCancel={onCancel} />
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
        <AddDepartmentForm onCancel={onCancel} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "FIN" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancel/i }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("AddDepartmentForm — success message stays visible after a 202", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the submitted confirmation (not wiped by the field reset)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "x1", status: "created" }), { status: 202 })));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddDepartmentForm onCancel={vi.fn()} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "FIN" } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Finance Department" } });
    fireEvent.click(screen.getByRole("button", { name: /add department/i }));
    expect(await screen.findByText(/submitted — it will appear shortly/i)).toBeInTheDocument();
    expect(screen.getByText(/Finance Department/)).toBeInTheDocument();
  });
});
