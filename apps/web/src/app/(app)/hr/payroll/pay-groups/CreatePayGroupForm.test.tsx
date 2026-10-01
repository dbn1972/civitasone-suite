import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreatePayGroupForm, isValidTimeZone } from "./CreatePayGroupForm";

// UX-017: CreatePayGroupForm now reads its copy through next-intl
// (useTranslations("createPayGroupForm")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreatePayGroupForm />
    </NextIntlClientProvider>,
  );
}

describe("CreatePayGroupForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a name before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));
    expect(screen.getByText("Pay group name is required.")).toBeInTheDocument();
  });

  it("creates a pay group on confirm (happy path)", async () => {
    // The real API answers 202 with a command acknowledgement and no group
    // body; reading res.data.name used to throw after a successful create.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "pg1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Weekly Wage Staff" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));

    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));

    await waitFor(() => {
      expect(screen.getByText(/Pay group "Weekly Wage Staff" created\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.timezone).toBe("Asia/Kolkata");
  });

  it("offers timezones from a list and validates IANA names (PAY-GROUPS-04)", () => {
    renderForm();
    expect((screen.getByLabelText(/Timezone/) as HTMLElement).tagName).toBe("SELECT");
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("explains month-end and non-monthly pay-day behaviour (PAY-GROUPS-01)", () => {
    renderForm();
    expect(screen.getByText(/pay falls on its last day/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Frequency/), { target: { value: "weekly" } });
    expect(screen.getByText(/weekday schedules are not supported yet/)).toBeInTheDocument();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Duplicate Group" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));

    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 409/)).not.toBeInTheDocument();
  });
});
