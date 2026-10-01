import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RequestAdvanceForm } from "./RequestAdvanceForm";

const EMPLOYEES = [{ id: "e1", name: "Test Employee", employeeNo: "EMP001" }];

// GAP-HR-ADVANCES-07: this component now renders through useTranslations
// (next-intl's client entry, not the next-intl/server mock apps/web's
// vitest.setup.ts provides) -- every render needs a real
// NextIntlClientProvider, the same convention GrievancesTable.test.tsx
// already established for "use client" components with real i18n.
function renderForm(props: Parameters<typeof RequestAdvanceForm>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RequestAdvanceForm {...props} />
    </NextIntlClientProvider>,
  );
}

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim on both the not-ok response branch and
 * the catch branch (`err.message`) — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("RequestAdvanceForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/hrms/employees")) {
        return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
      }
      return Promise.resolve(new Response("", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function openAndFillForm() {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));
    await waitFor(() => expect(screen.getByRole("option", { name: /test employee/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/employee/i), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "Medical expense" } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, on a plain failed response", async () => {
    await openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw server error message on a JSON error body", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/hrms/employees")) {
        return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ message: "duplicate advance request for this period" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    await openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/duplicate advance request/);
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
            fieldErrors: [{ field: "purpose", message: "Purpose contains disallowed characters." }],
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      );
    });
    await openAndFillForm();

    expect(await screen.findByText("Purpose contains disallowed characters.")).toBeInTheDocument();
  });
});

describe("RequestAdvanceForm — GAP-HR-ADVANCES-03 self-service", () => {
  beforeEach(() => {
    fetchMock2.mockReset();
    vi.stubGlobal("fetch", fetchMock2);
  });
  afterEach(() => vi.unstubAllGlobals());

  const fetchMock2 = vi.fn();

  it("selfServiceOnly hides the employee picker and never calls the employees endpoint", async () => {
    renderForm({ selfServiceOnly: true });
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));

    expect(screen.queryByLabelText(/employee/i)).not.toBeInTheDocument();
    expect(fetchMock2).not.toHaveBeenCalledWith(expect.stringContaining("/hrms/employees"), expect.anything());
  });

  it("selfServiceOnly submits without an employeeId in the request body", async () => {
    fetchMock2.mockResolvedValue(new Response(JSON.stringify({ id: "adv-1", status: "pending" }), { status: 202 }));
    renderForm({ selfServiceOnly: true });
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "Festival advance" } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => expect(fetchMock2).toHaveBeenCalledWith("/api/proxy/v1/hrms/salary-advances", expect.anything()));
    const [, init] = fetchMock2.mock.calls.find(([url]) => url === "/api/proxy/v1/hrms/salary-advances")!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.employeeId).toBeUndefined();
  });
});
