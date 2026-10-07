import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

const successMock = vi.fn();
vi.mock("../../_components/ds", () => ({
  useToast: () => ({ toast: { success: successMock, error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import { ReplayTourButton } from "./ReplayTourButton";
import { TOUR_STORAGE_KEY } from "../dashboard/FirstRunTour";

describe("ReplayTourButton (GAP-HELP-HOME-04)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    successMock.mockReset();
  });

  it("blocked storage: shows an alert and does NOT navigate", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ReplayTourButton />);
    fireEvent.click(screen.getByRole("button", { name: /take the welcome tour again/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/blocking saved settings/i);
    expect(pushMock).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("normal path: removes the key and navigates with router.push", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => undefined);
    render(<ReplayTourButton />);
    fireEvent.click(screen.getByRole("button", { name: /take the welcome tour again/i }));

    expect(spy).toHaveBeenCalledWith(TOUR_STORAGE_KEY);
    expect(successMock).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
