import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import CRMAccountDetailLoading from "./loading";

describe("Account detail loading skeleton (GAP-CRM-ACCOUNTS-DETAIL-07)", () => {
  it("mirrors the two-column layout and inherits the shell", () => {
    const { container } = renderWithIntl(<CRMAccountDetailLoading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    // Two-column g-main grid present, matching the loaded page.
    expect(container.querySelector(".g-main")).not.toBeNull();
    // No full-screen slate wrapper (inherits app-shell padding).
    expect(container.querySelector(".min-h-screen")).toBeNull();
    expect(container.querySelector(".bg-slate-50")).toBeNull();
  });
});
