import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import CRMLoading from "./loading";

describe("CRM hub loading skeleton (GAP-CRM-HOME-04)", () => {
  it("renders a busy tile-hub skeleton that inherits the shell (no min-h-screen / stat row)", () => {
    const { container } = renderWithIntl(<CRMLoading />);
    const root = container.querySelector('[aria-busy="true"]');
    expect(root).not.toBeNull();
    // Inherits the app shell: no full-screen slate wrapper.
    expect(container.querySelector(".min-h-screen")).toBeNull();
    expect(container.querySelector(".bg-slate-50")).toBeNull();
    // Mirrors five tile sections (header bar + 5 section groups), no 4-tile
    // stat row grid like the old loader had.
    expect(container.querySelectorAll(".grid-cols-2").length).toBe(0);
  });
});
