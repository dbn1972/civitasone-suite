import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Capture the props the (dynamically-imported, reactflow-heavy) canvas receives
// without rendering reactflow itself.
let capturedProps: Record<string, unknown> | null = null;
vi.mock("./_components/DesignerCanvasClient", () => ({
  DesignerCanvas: (props: Record<string, unknown>) => {
    capturedProps = props;
    return null;
  },
}));

const getDesignerDefinitions = vi.fn();
vi.mock("./_data/designerData", () => ({
  getDesignerDefinitions: (...a: unknown[]) => getDesignerDefinitions(...a),
}));

const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
  // Mirror the real constant so the page's membership check is exercised.
  WORKFLOW_DESIGNER_AUTHOR_ROLES: ["workflow_admin", "super_admin", "tenant_admin"],
}));

import WorkflowDesignerPage from "./page";

describe("WorkflowDesignerPage — GAP2-DESIGNER-HOME-01 authoring gate", () => {
  beforeEach(() => {
    capturedProps = null;
    getDesignerDefinitions.mockReset();
    getDesignerDefinitions.mockResolvedValue({ data: [], source: "api" });
    getSessionRolesMock.mockReset();
  });

  it("passes canAuthor=false to the canvas for a non-admin role", async () => {
    getSessionRolesMock.mockReturnValue(["workflow_user"]);
    render(await WorkflowDesignerPage({ searchParams: {} }));
    expect(capturedProps).toBeTruthy();
    expect(capturedProps?.canAuthor).toBe(false);
  });

  it("passes canAuthor=true to the canvas for a workflow_admin", async () => {
    getSessionRolesMock.mockReturnValue(["workflow_admin"]);
    render(await WorkflowDesignerPage({ searchParams: {} }));
    expect(capturedProps?.canAuthor).toBe(true);
  });
});
