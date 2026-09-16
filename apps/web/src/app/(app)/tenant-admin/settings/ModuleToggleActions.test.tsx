import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ModuleToggleActions } from "./ModuleToggleActions";

const MODULES = [{ moduleKey: "finance", moduleName: "Finance", enabled: true, enabledAt: null }];

describe("ModuleToggleActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when saving toggles fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("admin-service: module toggle command rejected by consumer", { status: 500 }),
    );

    render(<ModuleToggleActions modules={MODULES} />);
    fireEvent.click(screen.getByRole("switch", { name: /Finance module/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/rejected by consumer/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b500\b/);
  });
});
