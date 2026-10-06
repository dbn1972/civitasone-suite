import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { ModuleToggleActions } from "./ModuleToggleActions";

const MODULES = [
  { moduleKey: "finance", moduleName: "Finance", enabled: true, enabledAt: null },
  { moduleKey: "hr", moduleName: "HR", enabled: true, enabledAt: null },
  { moduleKey: "crm", moduleName: "CRM", enabled: true, enabledAt: null },
];

function openSaveDialogAfterToggling(switchName: RegExp) {
  fireEvent.click(screen.getByRole("switch", { name: switchName }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

describe("ModuleToggleActions — confirm + reason (GAP-TENANT-ADMIN-SETTINGS-02)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("Save opens a confirm dialog that requires a reason before any request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<ModuleToggleActions modules={[MODULES[0]]} />);
    openSaveDialogAfterToggling(/Finance module/i);

    const dialog = await screen.findByRole("alertdialog");
    // No request yet — the dialog is up, reason not entered.
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Finance disabled pending audit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ enabled: false, reason: "Finance disabled pending audit" });
  });

  it("uses the 'Enabled/Disabled' vocabulary on the switches (GAP-TENANT-ADMIN-SETTINGS-04)", () => {
    render(<ModuleToggleActions modules={[MODULES[0]]} />);
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /Finance module/i }));
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("reports partial failure and still refreshes (GAP-TENANT-ADMIN-SETTINGS-03)", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      // Second toggle fails.
      return call === 2 ? new Response("boom", { status: 500 }) : new Response(null, { status: 202 });
    });

    render(<ModuleToggleActions modules={MODULES} />);
    fireEvent.click(screen.getByRole("switch", { name: /Finance module/i }));
    fireEvent.click(screen.getByRole("switch", { name: /HR module/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "cleanup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Saved 1 of 2/i));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a clerk-safe message, never the raw response body, when saving fails (UX-016)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("admin-service: module toggle command rejected by consumer", { status: 500 }),
    );

    render(<ModuleToggleActions modules={[MODULES[0]]} />);
    openSaveDialogAfterToggling(/Finance module/i);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "cleanup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/rejected by consumer/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b500\b/);
  });
});
