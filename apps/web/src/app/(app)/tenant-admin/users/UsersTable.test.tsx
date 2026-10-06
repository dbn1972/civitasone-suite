import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds";

// UsersTable now emits a success toast on invite (GAP-TENANT-ADMIN-USERS-03),
// so it must render inside a ToastProvider.
function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

// GAP-TENANT-ADMIN-HOME-03: controls the ?invite= param UsersTable reads to
// auto-open the invite dialog when linked from the tenant-admin home CTA.
let mockSearch = "";

vi.mock("@/lib/sync/resource", () => ({
  // Matches the real hook's deriveProvenance() (src/lib/sync/resource.ts):
  // a failed server fetch with nothing cached resolves to "error-no-data",
  // never "cache" -- an earlier version of this mock said "cache" here,
  // which doesn't exist as an outcome for an empty-seed + errored source and
  // would have hidden a real bug (see the Bug B describe block below).
  useSeededResource: (_key: string, seed: unknown, source: string) => ({
    data: seed,
    provenance: source === "error" ? "error-no-data" : "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { UsersTable } from "./UsersTable";

describe("UsersTable (InviteUserDialog) — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearch = "";
  });

  it("shows a clerk-safe message, never the raw response body, when inviting a user fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("identity-service: duplicate email constraint on tenant_users", { status: 409 }),
    );

    renderWithToast(<UsersTable users={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Invite User" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Full name/i), { target: { value: "Asha Verma" } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/i), { target: { value: "asha@gov.in" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(dialog.textContent).toMatch(/This invitation was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(dialog.textContent).not.toMatch(/duplicate email constraint/i);
    expect(dialog.textContent).not.toMatch(/\b409\b/);
  });
});

describe("UsersTable — Bug B (fix/tenant-admin-and-establishment-nav): honest empty directory state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearch = "";
  });

  const makeUser = (overrides: Partial<{
    id: string; name: string; email: string; roles: string[]; mfaEnabled: boolean; status: string;
  }> = {}) => ({
    id: "u1", name: "Asha Verma", email: "asha@gov.in", roles: [], mfaEnabled: false, status: "active",
    ...overrides,
  });

  it("explains WHY the directory is empty instead of DataTable's generic 'No records found', when there are genuinely zero users", async () => {
    renderWithToast(<UsersTable users={[]} />);

    expect(screen.getByText(/No users in this directory yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Keycloak/i)).toBeInTheDocument();
    expect(screen.queryByText(/No records found/i)).not.toBeInTheDocument();

    // Distinct label from the toolbar's own "+ Invite User" button (same
    // handler) -- both must resolve unambiguously by accessible name.
    expect(screen.getByRole("button", { name: "+ Invite User" })).toBeInTheDocument();
    const firstUserBtn = screen.getByRole("button", { name: "+ Invite your first user" });
    expect(firstUserBtn).toBeInTheDocument();

    fireEvent.click(firstUserBtn);
    expect(await screen.findByRole("alertdialog", { name: /Invite a user/i })).toBeInTheDocument();
  });

  it("keeps DataTable's normal empty-filter behaviour when real users exist but a status filter matches none", () => {
    renderWithToast(<UsersTable users={[makeUser({ status: "active" })]} />);

    fireEvent.click(screen.getByRole("tab", { name: "Suspended" }));

    // The directory is NOT empty (one real active user exists) -- only the
    // "Suspended" filter view is -- so this must NOT claim "no users in this
    // directory yet" (that would be false), and must not offer the
    // empty-directory-specific "+ Invite your first user" action either.
    expect(screen.queryByText(/No users in this directory yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Invite your first user" })).not.toBeInTheDocument();
  });

  it("shows the real directory rows (e.g. the caller's own account) once the loader returns them, instead of an empty state", () => {
    renderWithToast(<UsersTable users={[makeUser({ name: "uxtester", email: "uxtester@gov.in" })]} />);

    expect(screen.queryByText(/No users in this directory yet/i)).not.toBeInTheDocument();
    expect(screen.getByText("uxtester")).toBeInTheDocument();
  });

  it("does NOT claim 'accounts aren't synced from Keycloak' when the fetch genuinely failed (provenance error-no-data) -- caught live: a rejected auth token also yields rows.length===0, and the Keycloak-sync explanation would be false for a plain fetch/auth error", () => {
    renderWithToast(<UsersTable users={[]} source="error" />);

    // The DataSourceBadge above the table is the one place this file reports
    // a failed fetch (UX-012) -- it must say so...
    expect(screen.getByText(/Couldn't load — showing nothing/i)).toBeInTheDocument();
    // ...but the table's own empty state must NOT layer a second, specific,
    // and in this case WRONG narrative about Keycloak account sync on top of
    // a genuine fetch failure that has nothing to do with Keycloak sync.
    expect(screen.queryByText(/No users in this directory yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Keycloak/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Invite your first user" })).not.toBeInTheDocument();
  });
});

describe("UsersTable — GAP-TENANT-ADMIN-USERS-01 (Department column removed)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("has no Department column header (identity-service exposes no department field)", () => {
    renderWithToast(<UsersTable users={[{ id: "u1", name: "Asha", email: "asha@gov.in", roles: ["tenant_admin"], mfaEnabled: true, status: "active" }]} />);
    expect(screen.queryByRole("columnheader", { name: /Department/i })).not.toBeInTheDocument();
  });
});

describe("UsersTable — GAP-TENANT-ADMIN-USERS-04 (all roles + MFA header)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the first role plus a '+N' badge for a multi-role user instead of only roles[0]", () => {
    renderWithToast(<UsersTable users={[{ id: "u1", name: "Asha", email: "asha@gov.in", roles: ["tenant_admin", "auditor", "approver"], mfaEnabled: false, status: "active" }]} />);
    expect(screen.getByText("tenant_admin")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    // the "+2" badge exposes the remaining roles for a11y / hover.
    expect(screen.getByText("+2")).toHaveAttribute("title", "tenant_admin, auditor, approver");
  });

  it("renames the 'SSO / MFA' header to 'MFA' (no SSO data exists)", () => {
    renderWithToast(<UsersTable users={[{ id: "u1", name: "Asha", email: "asha@gov.in", roles: ["tenant_admin"], mfaEnabled: true, status: "active" }]} />);
    expect(screen.getByRole("columnheader", { name: /^MFA$/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /SSO/i })).not.toBeInTheDocument();
  });
});

describe("UsersTable — GAP-TENANT-ADMIN-HOME-03: ?invite=1 opens the invite dialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearch = "";
  });

  it("opens the invite dialog on mount when the URL carries invite=1 (home-page CTA deep-link)", async () => {
    mockSearch = "invite=1";
    renderWithToast(<UsersTable users={[]} />);
    expect(await screen.findByRole("alertdialog", { name: /Invite a user/i })).toBeInTheDocument();
  });

  it("does NOT open the invite dialog without the invite param", () => {
    mockSearch = "";
    renderWithToast(<UsersTable users={[]} />);
    expect(screen.queryByRole("alertdialog", { name: /Invite a user/i })).not.toBeInTheDocument();
  });
});

describe("UsersTable — GAP-TENANT-ADMIN-USERS-03 (invite success toast)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearch = "";
  });

  it("shows a success toast naming the invitee's email after a successful invite", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    renderWithToast(<UsersTable users={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Invite User" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Full name/i), { target: { value: "Asha Verma" } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/i), { target: { value: "asha@gov.in" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(screen.getByText(/Invitation sent to asha@gov\.in\. It may take a moment to appear in the directory\./i)).toBeInTheDocument(),
    );
  });
});
