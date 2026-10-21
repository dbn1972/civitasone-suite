import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CRM_PIPELINE_WRITE_ROLES } from "@/lib/auth/roleGuard";

// Same convention as agent-workload/layout.test.tsx: control the session-role
// JWT claim via cookies() and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import PipelinesLayout from "./layout";

describe("PipelinesLayout (GAP-CRM-PIPELINES-03)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain crm_user away from the pipeline editor", () => {
    // Regression: this route had no layout and fell through to the broad CRM
    // layout, so any crm_user got a fully-wired create/edit/delete editor.
    sessionWithRoles(["crm_user"]);
    render(<PipelinesLayout>{"pipeline editor"}</PipelinesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });

  it("admits crm_admin", () => {
    sessionWithRoles(["crm_admin"]);
    render(<PipelinesLayout>{"pipeline editor"}</PipelinesLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("pipeline editor")).toBeInTheDocument();
  });

  it("admits super_admin as well as crm_admin (the roles the server admits on pipeline writes)", () => {
    sessionWithRoles(["super_admin"]);
    render(<PipelinesLayout>{"pipeline editor"}</PipelinesLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("pipeline editor")).toBeInTheDocument();
  });

  // tenant_admin cleared the broader CRM_ADMIN_ROLES gate and was handed a wired editor whose
  // every call answered 403 (it is not in crm-service's pipeline read OR write set); admin /
  // platform_admin never clear the parent CRM layout. Narrowing the web gate to the server's set
  // changes nobody's real access.
  it.each(["tenant_admin", "admin", "platform_admin"])(
    "redirects %s to /crm instead of showing an editor whose calls cannot succeed",
    (role) => {
      sessionWithRoles([role]);
      render(<PipelinesLayout>{"pipeline editor"}</PipelinesLayout>);
      expect(mockRedirect).toHaveBeenCalledWith("/crm");
    },
  );

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<PipelinesLayout>{"pipeline editor"}</PipelinesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });
});

describe("CRM_PIPELINE_WRITE_ROLES vs crm-service (drift guard)", () => {
  /** crm-service's own PIPELINE_WRITE_ROLES for POST/PATCH/DELETE /v1/crm/pipelines, read from source. */
  function serverPipelineWriteRoles(): string[] {
    const file = path.resolve(process.cwd(), "../../services/crm-service/src/modules/pipelines/routes.ts");
    const m = /const PIPELINE_WRITE_ROLES = \[([^\]]*)\]/.exec(readFileSync(file, "utf8"));
    if (!m) throw new Error("PIPELINE_WRITE_ROLES not found in crm-service pipelines/routes.ts");
    return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  }

  it("mirrors the server constant exactly", () => {
    expect([...CRM_PIPELINE_WRITE_ROLES].sort()).toEqual([...serverPipelineWriteRoles()].sort());
  });
});
