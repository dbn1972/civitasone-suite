import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * GAP-CRM-TASK-ESCALATION-03 - the managers who RECEIVE escalations must be able to watch what is
 * overdue without holding crm_admin, while the rule EDITOR stays admin-only:
 *
 *   crm_user  -> /crm/overdue-tasks opens; /crm/task-escalation redirects to /crm
 *   crm_admin -> both open
 *
 * The session role comes from the JWT cookie and redirect() is observed, exactly as in
 * crm/layout.test.tsx and agent-workload/layout.test.tsx.
 */
const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => mockRedirect(...args) }));
vi.mock("../../ModuleGate", () => ({ ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("@/messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});
// The client components do network work of their own; this test is about WHO reaches them.
vi.mock("../../../_components/crm/OverdueTaskAlerts", () => ({
  OverdueTaskAlerts: () => <div data-testid="overdue-alerts" />,
}));
vi.mock("../../../_components/crm/TaskEscalationEditor", () => ({
  TaskEscalationEditor: () => <div data-testid="rule-editor" />,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import CrmLayout from "../layout";
import TaskEscalationLayout from "../task-escalation/layout";
import TaskEscalationPage from "../task-escalation/page";
import OverdueTasksPage from "./page";

beforeEach(() => {
  mockGet.mockReset();
  mockRedirect.mockReset();
});

/** What a browser request to `path` ends up with: the redirects its layouts issue, and its page. */
async function open(path: "overdue" | "editor") {
  const layoutOne = render(<CrmLayout>{"x"}</CrmLayout>);
  layoutOne.unmount();
  if (path === "editor") {
    const layoutTwo = render(<TaskEscalationLayout>{"x"}</TaskEscalationLayout>);
    layoutTwo.unmount();
  }
  const Page = path === "overdue" ? OverdueTasksPage : TaskEscalationPage;
  render(await Page());
}

describe("overdue-task monitor vs rule editor access (GAP-CRM-TASK-ESCALATION-03)", () => {
  it("lets a crm_user open the overdue list without any redirect", async () => {
    sessionWithRoles(["crm_user"]);
    await open("overdue");
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByTestId("overdue-alerts")).toBeInTheDocument();
    expect(screen.queryByTestId("rule-editor")).not.toBeInTheDocument();
  });

  it("redirects a crm_user away from the rule editor, back to /crm", async () => {
    sessionWithRoles(["crm_user"]);
    await open("editor");
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });

  it.each([["crm_admin"], ["tenant_admin"], ["super_admin"]])("lets %s open both the overdue list and the rule editor", async (role) => {
    sessionWithRoles([role]);
    await open("overdue");
    expect(screen.getByTestId("overdue-alerts")).toBeInTheDocument();
    mockRedirect.mockReset();
    await open("editor");
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByTestId("rule-editor")).toBeInTheDocument();
  });

  it("keeps a session with no CRM role out of the overdue list altogether", async () => {
    sessionWithRoles(["finance_user"]);
    await open("overdue");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("the editor page points managers at the monitor", async () => {
    sessionWithRoles(["crm_admin"]);
    render(await TaskEscalationPage());
    expect(screen.getByRole("link", { name: /overdue tasks/i })).toHaveAttribute("href", "/crm/overdue-tasks");
  });
});
