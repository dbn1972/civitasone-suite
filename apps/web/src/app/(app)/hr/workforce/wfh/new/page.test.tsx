import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WfhNewRedirect from "./page";

// GAP-HR-WORKFORCE-WFH-NEW-01: a visitor following /hr/workforce/wfh/new
// (e.g. a guessed "/new" suffix, or a stale deep link) used to land on the
// plain /hr/wfh list with no indication where the "New Request" form
// actually is. The #new-request fragment scrolls straight to it instead
// (see hr/wfh/page.test.tsx's "#new-request anchor target" coverage for the
// matching element this targets).
describe("WfhNewRedirect", () => {
  it("redirects to the canonical /hr/wfh page, anchored to the New Request card", () => {
    WfhNewRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/wfh#new-request");
  });
});
