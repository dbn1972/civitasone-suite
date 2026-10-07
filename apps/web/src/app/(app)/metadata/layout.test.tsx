import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
// ModuleGate is an async Server Component; stub it to a passthrough so this
// test exercises only the role gate.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: unknown }) => children,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });
}

import MetadataLayout from "./layout";

// GAP-METADATA-HOME-01: the /metadata segment had no layout and no role gate,
// so any signed-in user could open the schema-configuration hub. Fails on the
// old tree (no layout existed).
describe("MetadataLayout role gate (GAP-METADATA-HOME-01)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain tenant user (employee) away from the metadata module", () => {
    sessionWithRoles(["employee"]);
    render(<MetadataLayout>{"metadata hub"}</MetadataLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<MetadataLayout>{"metadata hub"}</MetadataLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects metadata_user (the records-only role is not a schema admin)", () => {
    sessionWithRoles(["metadata_user"]);
    render(<MetadataLayout>{"metadata hub"}</MetadataLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each(["metadata_admin", "platform_admin", "super_admin"])(
    "admits %s (mirrors metadata-service ADMIN set)",
    (role) => {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      render(<MetadataLayout>{`hub ${role}`}</MetadataLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );
});
