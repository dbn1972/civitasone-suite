import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedirect = vi.fn((_dest: string) => {
  // next/navigation's redirect throws internally to halt rendering; emulate
  // just the recording so we can assert the destination.
});
vi.mock("next/navigation", () => ({
  redirect: (dest: string) => mockRedirect(dest),
}));

import SessionsPage from "./sessions/page";
import UsersPage from "./users/page";
import ApiKeysPage from "./api-keys/page";
import BreakglassPage from "./breakglass/page";

describe("identity sub-routes redirect to canonical tenant-admin pages", () => {
  beforeEach(() => mockRedirect.mockClear());

  it("GAP-IDENTITY-SESSIONS-02: /identity/sessions → /tenant-admin/sessions", () => {
    SessionsPage();
    expect(mockRedirect).toHaveBeenCalledWith("/tenant-admin/sessions");
  });

  it("GAP-IDENTITY-USERS-02: /identity/users → /tenant-admin/users", () => {
    UsersPage();
    expect(mockRedirect).toHaveBeenCalledWith("/tenant-admin/users");
  });

  it("GAP-IDENTITY-API-KEYS-02: /identity/api-keys → /tenant-admin/api-keys", () => {
    ApiKeysPage();
    expect(mockRedirect).toHaveBeenCalledWith("/tenant-admin/api-keys");
  });

  it("GAP-IDENTITY-BREAKGLASS-02: /identity/breakglass → /tenant-admin/breakglass", () => {
    BreakglassPage();
    expect(mockRedirect).toHaveBeenCalledWith("/tenant-admin/breakglass");
  });
});
