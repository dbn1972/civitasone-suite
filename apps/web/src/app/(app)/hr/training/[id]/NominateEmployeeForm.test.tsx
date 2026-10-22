import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const EMP = "44444444-4444-4444-8444-444444444444";
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => [{ id: "44444444-4444-4444-8444-444444444444", label: "Asha Rao (E-9)", sublabel: "Finance" }]),
  resolveEmployees: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, label: "Asha Rao (E-9)" }))),
}));

import { NominateEmployeeForm } from "./NominateEmployeeForm";

function renderForm(locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <NominateEmployeeForm trainingId="training-1" />
    </NextIntlClientProvider>,
  );
}

async function pickAsha() {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "asha" } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: /Asha Rao/ })); // EntityPicker selects on mousedown
}

/**
 * GAP-HR-TRAINING-01: the "HR nominates an employee" half. POST /nominations has
 * always let HR choose any employee, but the only UI was self-enrol.
 */
describe("NominateEmployeeForm — GAP-HR-TRAINING-01 (HR nominates an employee)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs {trainingId, employeeId} for the PICKED employee and says the nomination was submitted", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "nom-1", status: "accepted" }), { status: 202 }));
    renderForm();

    await pickAsha();
    fireEvent.click(screen.getByRole("button", { name: "Nominate" }));

    // (EntityPicker owns an empty sr-only role="status" of its own, so find ours by its text.)
    const submitted = await screen.findByText(/^Nomination submitted/);
    expect(submitted).toHaveAttribute("role", "status");
    expect(screen.getByRole("link", { name: "View nominations" })).toHaveAttribute("href", "/hr/training/nominations");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/nominations",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ trainingId: "training-1", employeeId: EMP }) }),
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("refuses to submit with nobody picked: inline error, no request", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Nominate" }));
    expect(screen.getByText("Choose an employee to nominate.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed request shows clerk-safe copy (no status, no raw server text) and stays usable", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "INTERNAL", message: "pq: deadlock detected" }), { status: 500 }));
    renderForm();

    await pickAsha();
    fireEvent.click(screen.getByRole("button", { name: "Nominate" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/deadlock|INTERNAL|\b500\b/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Nominate" })).not.toBeDisabled());
    expect(screen.queryByText(/^Nomination submitted/)).not.toBeInTheDocument();
  });

  it("Hindi: heading, label, placeholder, button and the submitted message are all translated", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "nom-1", status: "accepted" }), { status: 202 }));
    renderForm("hi");

    expect(screen.getByText("किसी कर्मचारी को नामांकित करें")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("नाम या कर्मचारी संख्या से खोजें…")).toBeInTheDocument();
    expect(screen.queryByText("Nominate an employee")).not.toBeInTheDocument();

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "asha" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Asha Rao/ })); // EntityPicker selects on mousedown
    fireEvent.click(screen.getByRole("button", { name: "नामांकित करें" }));

    expect(await screen.findByText(/^नामांकन जमा किया गया/)).toHaveAttribute("role", "status");
  });
});
