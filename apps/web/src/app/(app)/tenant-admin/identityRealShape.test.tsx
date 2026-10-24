/**
 * Contract + screen tests for the IdP, SSO and Security Center screens against the REAL
 * admin-service response shapes (services/admin-service/src/modules/identity-providers/routes.ts and
 * gap/security-overview.ts; both validate against the shared schemas in @civitasone/schemas/web).
 *  - the loaders accept exactly what the routes send and reject anything off-contract
 *  - the screens render those shapes, including a provider that has never synced (lastSync: null)
 *  - a client secret can never reach the screen: the contract has no field for it
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminIdpProviderListSchema, AdminSsoProviderListSchema, AdminSecurityOverviewSchema } from "@civitasone/schemas/web";

const fetchJsonMock = vi.fn();
const { getIdp, getSso, getSec } = vi.hoisted(() => ({ getIdp: vi.fn(), getSso: vi.fn(), getSec: vi.fn() }));

vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...a: unknown[]) => fetchJsonMock(...a) };
});
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, data: unknown) => ({ data, provenance: "live", offline: false, cachedAt: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { getIdpProviders, getSsoProviders, getSecurityOverview } from "@/app/_data/loaders";

type Opts = { responseSchema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }; mapResponse: (p: unknown) => unknown };
async function optsFor(call: () => Promise<unknown>): Promise<Opts> {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
  await call();
  return fetchJsonMock.mock.calls[0]![2] as Opts;
}
/** Run a raw gateway payload through the loader's own validation + mapping, as fetchJson does. */
function load(o: Opts, raw: unknown): unknown | null {
  const parsed = o.responseSchema.safeParse(raw);
  return parsed.success ? o.mapResponse(parsed.data) : null;
}

// Exactly what GET /v1/admin/idp/providers answers (see tests/identity-providers.test.ts).
const IDP_RESPONSE = {
  data: [
    { id: "dd6568d9-e6ff-435f-a29d-443fb5f9e3ea", name: "Corporate LDAP", protocol: "LDAP", status: "active", usersSynced: 120, lastSync: "2026-10-23T10:00:00.000Z", endpoint: "ldaps://ldap.example.gov.in:636/dc=nic,dc=in", hasClientSecret: true },
    { id: "0b0e9a52-0c13-4f4b-8d4e-2f1c2b7a9a10", name: "New directory", protocol: "OIDC", status: "inactive", usersSynced: 0, lastSync: null, endpoint: "https://idp.example.gov.in", hasClientSecret: false },
  ],
  meta: { page: 1, pageSize: 100, total: 2 },
};
// Exactly what GET /v1/admin/sso/providers answers.
const SSO_RESPONSE = {
  data: [
    { id: "5c1d3a0e-9b0a-4b6e-9d57-0d9d6a7a1c11", name: "MeriPehchaan", protocol: "SAML", entityId: "https://sso.example.gov.in/entity", status: "active", lastSync: "2026-10-24T01:30:00.000Z", hasClientSecret: true },
    { id: "9a7d2c10-3e55-4a39-8a0a-6f2f7f0b2d22", name: "Draft SSO", protocol: "OIDC", entityId: "", status: "inactive", lastSync: null, hasClientSecret: false },
  ],
  meta: { page: 1, pageSize: 100, total: 2 },
};
// Exactly what GET /v1/admin/security/overview answers.
const OVERVIEW_RESPONSE = {
  activeSessions: 7,
  failedLogins24h: 5,
  mfaAdoptionRate: 40,
  trustedDevices: 3,
  events: [
    { id: "11111111-1111-4111-8111-111111111111", timestamp: "2026-10-24T08:00:00.000Z", type: "mfa_verify_failed", actor: "a@nic.in", ipAddress: "10.1.2.3", outcome: "failure" },
    { id: "22222222-2222-4222-8222-222222222222", timestamp: "2026-10-24T07:00:00.000Z", type: "mfa_enable", actor: "u2", ipAddress: "—", outcome: "success" },
  ],
};

describe("loader contract", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("fixtures satisfy the shared schemas the routes validate against", () => {
    expect(AdminIdpProviderListSchema.safeParse(IDP_RESPONSE).success).toBe(true);
    expect(AdminSsoProviderListSchema.safeParse(SSO_RESPONSE).success).toBe(true);
    expect(AdminSecurityOverviewSchema.safeParse(OVERVIEW_RESPONSE).success).toBe(true);
  });

  it("getIdpProviders: calls the admin route, accepts the real shape, unwraps {data}", async () => {
    const o = await optsFor(getIdpProviders);
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/admin/idp/providers");
    const out = load(o, IDP_RESPONSE) as Array<{ name: string; lastSync: string | null }>;
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ name: "New directory", lastSync: null });
  });

  it("getSsoProviders: calls the admin route, accepts the real shape, unwraps {data}", async () => {
    const o = await optsFor(getSsoProviders);
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/admin/sso/providers");
    const out = load(o, SSO_RESPONSE) as Array<{ entityId: string }>;
    expect(out.map((p) => p.entityId)).toEqual(["https://sso.example.gov.in/entity", ""]);
  });

  it("getSecurityOverview: calls the admin route and accepts the real shape", async () => {
    const o = await optsFor(getSecurityOverview);
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/admin/security/overview");
    expect(load(o, OVERVIEW_RESPONSE)).toMatchObject({ activeSessions: 7, failedLogins24h: 5, mfaAdoptionRate: 40, trustedDevices: 3 });
  });

  it("an off-contract body (the old 501 error body, a missing field, a bad type) becomes null -> error state, never data", async () => {
    const idp = await optsFor(getIdpProviders);
    const sso = await optsFor(getSsoProviders);
    const sec = await optsFor(getSecurityOverview);
    expect(load(idp, { code: "NOT_IMPLEMENTED", message: "x" })).toBeNull();
    expect(load(sso, { data: [{ id: "not-a-uuid", name: "x" }] })).toBeNull();
    expect(load(sec, { ...OVERVIEW_RESPONSE, events: undefined })).toBeNull();
    expect(load(sec, { ...OVERVIEW_RESPONSE, activeSessions: "7" })).toBeNull();
  });

  it("the contract has no place for a secret: extra secret-ish keys are stripped before the screen sees them", async () => {
    const o = await optsFor(getIdpProviders);
    const leakedValue = `leak-${globalThis.crypto.randomUUID()}`;
    const leaky = { ...IDP_RESPONSE, data: [{ ...IDP_RESPONSE.data[0], clientSecret: leakedValue, clientSecretCiphertext: "enc:v2:k1:abc" }] };
    expect(JSON.stringify(load(o, leaky))).not.toMatch(new RegExp(`${leakedValue}|enc:v2|clientSecret`));
  });
});

describe("screens render the real shapes", () => {
  beforeEach(() => { getIdp.mockReset(); getSso.mockReset(); getSec.mockReset(); });

  it("IdpTable: a never-synced provider shows '—', not Invalid Date / 1970; endpoint is origin-only", async () => {
    const { IdpTable } = await import("./idp/IdpTable");
    render(<IdpTable source="api" providers={IDP_RESPONSE.data} />);
    expect(document.body.textContent).not.toMatch(/Invalid Date|1970/);
    expect(screen.getByText("ldaps://ldap.example.gov.in:636")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("dc=nic");
    expect(screen.getByText("Corporate LDAP")).toBeInTheDocument();
    expect(screen.getByText("New directory")).toBeInTheDocument();
  });

  it("SsoTable: lists both providers; null lastSync renders '—'", async () => {
    const { SsoTable } = await import("./sso/SsoTable");
    render(<SsoTable source="api" providers={SSO_RESPONSE.data} />);
    expect(screen.getByText("MeriPehchaan")).toBeInTheDocument();
    expect(screen.getByText("Draft SSO")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Invalid Date|1970/);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("IdP page: KPI and table from the real shape, with a null lastSync on an inactive provider", async () => {
    vi.doMock("@/app/_data/loaders", async () => {
      const actual = await vi.importActual<typeof import("@/app/_data/loaders")>("@/app/_data/loaders");
      return { ...actual, getIdpProviders: () => getIdp() };
    });
    vi.resetModules();
    getIdp.mockResolvedValue({ data: IDP_RESPONSE.data, source: "api" });
    const { default: Page } = await import("./idp/page");
    render(await Page());
    expect(screen.getByText("Corporate LDAP")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Invalid Date|NaN/);
    vi.doUnmock("@/app/_data/loaders");
  });

  it("SSO page: renders the real shape without errors", async () => {
    vi.doMock("@/app/_data/loaders", async () => {
      const actual = await vi.importActual<typeof import("@/app/_data/loaders")>("@/app/_data/loaders");
      return { ...actual, getSsoProviders: () => getSso() };
    });
    vi.resetModules();
    getSso.mockResolvedValue({ data: SSO_RESPONSE.data, source: "api" });
    const { default: Page } = await import("./sso/page");
    render(await Page());
    expect(screen.getByText("MeriPehchaan")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Invalid Date|NaN/);
    vi.doUnmock("@/app/_data/loaders");
  });

  it("Security Center: KPIs and the event table from the real shape (labels for the new event types)", async () => {
    vi.doMock("@/app/_data/loaders", async () => {
      const actual = await vi.importActual<typeof import("@/app/_data/loaders")>("@/app/_data/loaders");
      return { ...actual, getSecurityOverview: () => getSec() };
    });
    vi.resetModules();
    getSec.mockResolvedValue({ data: OVERVIEW_RESPONSE, source: "api" });
    const { default: Page } = await import("./security/page");
    render(await Page());
    expect(screen.getByText("7")).toBeInTheDocument();      // active sessions
    expect(screen.getByText("5")).toBeInTheDocument();      // failed logins (24h)
    expect(screen.getByText("40%")).toBeInTheDocument();    // MFA adoption
    expect(screen.getByText("MFA verification failed")).toBeInTheDocument();
    expect(screen.getByText("MFA enabled")).toBeInTheDocument();
    vi.doUnmock("@/app/_data/loaders");
  });
});
