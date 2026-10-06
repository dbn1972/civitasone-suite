import { describe, it, expect, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

import Page from "./page";

// GAP-TELEPHONY-LIST-05: the legacy list route now permanently redirects to the
// real Call Log instead of rendering an always-empty generic list.
describe("Telephony legacy list page", () => {
  it("redirects to /telephony/calls", () => {
    Page();
    expect(redirect).toHaveBeenCalledWith("/telephony/calls");
  });
});
