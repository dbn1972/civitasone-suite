import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

// Capture the prop the server wrapper passes into the client component.
const captured: { canManage?: boolean } = {};
vi.mock("../_components/CampaignDetail", () => ({
  CampaignDetail: (props: { canManage: boolean }) => {
    captured.canManage = props.canManage;
    return null;
  },
}));
vi.mock("../../../../_components/ds", () => ({ PageHeader: () => null }));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u-1", roles }) });
}

import CampaignPage from "./page";

// notification-service bulk/routes.ts gates campaign send/cancel with
// requireRole(["platform_admin","super_admin","tenant_admin"]); the UI must offer
// Send/Cancel to exactly those roles - notification_admin gets a 403 from the service.
describe("campaign detail page: Send/Cancel visibility matches the service gate", () => {
  beforeEach(() => {
    mockGet.mockReset();
    captured.canManage = undefined;
  });

  it.each(["platform_admin", "super_admin", "tenant_admin"])("offers management to %s", (role) => {
    sessionWithRoles([role]);
    render(CampaignPage({ params: { id: "c1" } }));
    expect(captured.canManage).toBe(true);
  });

  it.each(["notification_admin", "audit_officer", "notification_user"])("does NOT offer management to %s", (role) => {
    sessionWithRoles([role]);
    render(CampaignPage({ params: { id: "c1" } }));
    expect(captured.canManage).toBe(false);
  });
});
