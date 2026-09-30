import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StartOnboardingPicker } from "./StartOnboardingPicker";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

describe("StartOnboardingPicker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("GAP-HR-ONBOARDING-02: navigates to the selected employee's onboarding page, even one with no tasks yet", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "emp-9", name: "New Joinee", employeeNo: "E009" }] }),
    } as Response);

    render(<StartOnboardingPicker />);
    const input = screen.getByLabelText("Find an employee to start onboarding");
    fireEvent.change(input, { target: { value: "New" } });

    // EntityPicker selects on mousedown (fires before the input's blur would
    // otherwise close the dropdown), not click -- see EntityPicker.tsx.
    const option = await screen.findByText(/New Joinee/);
    fireEvent.mouseDown(option);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/hr/onboarding/emp-9"));
  });

  it("searches the real employee directory endpoint, not a bespoke one", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) } as Response);
    render(<StartOnboardingPicker />);
    fireEvent.change(screen.getByLabelText("Find an employee to start onboarding"), { target: { value: "abc" } });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("/api/proxy/v1/hrms/employees");
  });
});
