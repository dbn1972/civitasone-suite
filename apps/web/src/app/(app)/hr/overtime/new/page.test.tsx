import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import OvertimeNewPage from "./page";

const EMPLOYEES = [{ id: "e1", name: "Test Employee", employeeNo: "EMP001" }];

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OvertimeNewPage />
    </NextIntlClientProvider>,
  );
}

function mockPickerMode(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/hrms/employees")) {
      return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
    }
    return Promise.resolve(new Response("", { status: 500 }));
  });
}

async function fillAndSubmitPicker() {
  renderPage();
  await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/employee/i), { target: { value: "e1" } });
  fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
}

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Error ${res.status}`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("OvertimeNewPage — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    // mockPickerMode answers the GET /employees call with 200 and anything
    // else (the POST submission) with a plain 500 -- exactly the failure
    // this test exercises.
    mockPickerMode(fetchMock);
    await fillAndSubmitPicker();
    // Scoped to the alert itself, not the whole screen: the reason field's
    // "0/500 characters" counter innocently contains "500" too and would
    // otherwise false-positive this assertion.
    const alert = await screen.findByText(/couldn't save/i);
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/hrms/employees")) {
        return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: "VALIDATION_FAILED",
            message: "validation_failed",
            fieldErrors: [{ field: "employeeId", message: "Employee not found." }],
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      );
    });
    await fillAndSubmitPicker();

    expect(await screen.findByText("Employee not found.")).toBeInTheDocument();
  });
});

describe("OvertimeNewPage — GAP-HR-OVERTIME-NEW-01 employee identity", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a searchable picker (never a raw UUID input) when the caller has directory access", async () => {
    mockPickerMode(fetchMock);
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
    expect(screen.queryByPlaceholderText(/employee uuid/i)).not.toBeInTheDocument();
  });

  it("self-locks to the caller's own profile when the employees list 403s", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/hrms/employees")) {
        return Promise.resolve(new Response("", { status: 403 }));
      }
      if (typeof url === "string" && url.includes("/me/profile")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "self-1", fullName: "Self Employee", employeeNo: "EMP-SELF" }), { status: 200 }));
      }
      return Promise.resolve(new Response("", { status: 500 }));
    });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("Self Employee (EMP-SELF)")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Self Employee (EMP-SELF)")).toBeDisabled();
  });
});

describe("OvertimeNewPage — GAP-HR-OVERTIME-NEW-04 client-side validation", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    mockPickerMode(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a future-dated request client-side without a round trip", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/employee/i), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "2099-01-01" } });
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: "2" } });
    const postCallsBefore = fetchMock.mock.calls.filter(([u]) => typeof u === "string" && u.includes("/overtime-requests") && !u.includes("employees")).length;
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
    expect(await screen.findByText(/cannot be in the future/i)).toBeInTheDocument();
    const postCallsAfter = fetchMock.mock.calls.filter(([u]) => typeof u === "string" && u.includes("/overtime-requests") && !u.includes("employees")).length;
    expect(postCallsAfter).toBe(postCallsBefore);
  });

  it("shows a live character counter for the reason field", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "abc" } });
    expect(screen.getByText("3/500 characters")).toBeInTheDocument();
  });
});

describe("OvertimeNewPage — GAP-HR-OVERTIME-NEW-05 unsaved-changes guard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    mockPickerMode(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    pushMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("navigates immediately on Cancel when the form is untouched", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(pushMock).toHaveBeenCalledWith("/hr/overtime");
  });

  it("shows a discard-confirmation dialog on Cancel when a field has been touched", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByText(/discard this request/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
