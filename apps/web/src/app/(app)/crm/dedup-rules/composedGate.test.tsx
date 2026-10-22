import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

// GAP-CRM-DEDUP-RULES-05: the per-layout tests (crm/layout.test.tsx and
// dedup-rules/layout.test.tsx) each pass on their own while the COMPOSITION can
// still be wrong -- a role may clear one layout and be bounced by the other, or
// clear both and then 403 on the server. This drives the real parent + child
// layouts in order for every role and pins the reachable set against the
// crm-service constant, so the three gates cannot drift apart silently.

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
// ModuleGate reaches for server data; the role gate is what is under test.
vi.mock("../../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

import CrmLayout from "../layout";
import DedupRulesLayout from "./layout";
import { CRM_DEDUP_RULES_ROLES } from "@/lib/auth/roleGuard";

/** A role reaches /crm/dedup-rules only if NEITHER the module layout nor the page layout redirects it. */
function reachesDedupRules(role: string): boolean {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles: [role] }) });
  mockRedirect.mockReset();
  render(<CrmLayout>{null}</CrmLayout>).unmount();
  if (mockRedirect.mock.calls.length > 0) return false;
  render(<DedupRulesLayout>{null}</DedupRulesLayout>).unmount();
  return mockRedirect.mock.calls.length === 0;
}

/** crm-service's own ADMIN_ROLES for GET/PUT /v1/crm/dedup-rules, read from source. */
function serverDedupAdminRoles(): string[] {
  const file = path.resolve(process.cwd(), "../../services/crm-service/src/modules/contacts/dedup-routes.ts");
  const src = readFileSync(file, "utf8");
  const m = /const ADMIN_ROLES = \[([^\]]*)\]/.exec(src);
  if (!m) throw new Error("ADMIN_ROLES not found in crm-service dedup-routes.ts");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

describe("composed gate for /crm/dedup-rules (GAP-CRM-DEDUP-RULES-05)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("is reachable by exactly crm_admin and super_admin across the parent CRM layout and the page layout", () => {
    const roles = ["crm_user", "crm_admin", "super_admin", "tenant_admin", "admin", "platform_admin", "finance_user"];
    expect(roles.filter(reachesDedupRules).sort()).toEqual(["crm_admin", "super_admin"]);
  });

  it("every role that reaches the page is one crm-service admits on dedup-rules (no page that always 403s)", () => {
    const server = serverDedupAdminRoles();
    for (const role of ["crm_user", "crm_admin", "super_admin", "tenant_admin", "admin", "platform_admin"]) {
      if (reachesDedupRules(role)) expect(server, `${role} reaches the page but the server rejects it`).toContain(role);
    }
  });

  it("CRM_DEDUP_RULES_ROLES mirrors the server constant exactly (drift guard)", () => {
    expect([...CRM_DEDUP_RULES_ROLES].sort()).toEqual([...serverDedupAdminRoles()].sort());
  });
});
