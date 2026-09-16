import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ModuleApprovalBanner } from "./ModuleApprovalBanner";

describe("ModuleApprovalBanner — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when the approval request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("workflow-service: no active approval template for module_change", { status: 500 }),
    );

    render(
      <ModuleApprovalBanner
        roles={["tenant_admin"]}
        dirtyKeys={["finance"]}
        pendingState={{ finance: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Request Approval" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/no active approval template/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b500\b/);
  });
});
