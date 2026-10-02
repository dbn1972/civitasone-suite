/**
 * GAP-FINANCE-PFMS-05: GET /v1/finance/pfms/config reports the TWO integrations'
 * states separately, because two different env families gate them:
 *   - paymentRail  (adapter.ts: PFMS_ENABLED / PFMS_BASE_URL / PFMS_API_KEY)
 *       -> POST /v1/finance/pfms/payments. No sandbox: "live" or "disabled".
 *   - treasuryMode (pfms-client.ts: PFMS_TREASURY_*)
 *       -> salary-bill / payment-advice. "sandbox" (simulated) or "live".
 * Route-level test: repo and db are mocked, no Postgres needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const getTenantConfig = vi.fn();
const isEnabled = vi.fn();
vi.mock("../src/shared/db.js", () => ({ db: {} }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));
vi.mock("../src/modules/pfms/repo.js", () => ({ getTenantConfig: (...a: unknown[]) => getTenantConfig(...a) }));
vi.mock("../src/modules/pfms/adapter.js", () => ({ isEnabled: () => isEnabled() }));

import { pfmsRoutes } from "../src/modules/pfms/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000a1";
const ACTOR = "00000000-aaaa-4000-8000-0000000000a1";

async function get() {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(pfmsRoutes);
  await a.ready();
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["audit_officer"], actorType: "user" } as never, SECRET);
  return a.inject({ method: "GET", url: "/v1/finance/pfms/config", headers: { authorization: `Bearer ${token}` } });
}

describe("GET /v1/finance/pfms/config (GAP-FINANCE-PFMS-05)", () => {
  const saved = { base: process.env.PFMS_TREASURY_BASE_URL, key: process.env.PFMS_TREASURY_API_KEY };
  beforeEach(() => {
    getTenantConfig.mockReset().mockResolvedValue({ agencyCode: "AG01", defaultDdo: "DDO1" });
    isEnabled.mockReset().mockReturnValue(false);
    delete process.env.PFMS_TREASURY_BASE_URL;
    delete process.env.PFMS_TREASURY_API_KEY;
  });
  afterEach(() => {
    for (const [k, v] of [["PFMS_TREASURY_BASE_URL", saved.base], ["PFMS_TREASURY_API_KEY", saved.key]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("payment rail follows the ADAPTER's own check (PFMS_ENABLED family), never the treasury env", async () => {
    // treasury env fully configured, adapter NOT enabled => rail is disabled, treasury is live
    process.env.PFMS_TREASURY_BASE_URL = "https://pfms.example.test";
    process.env.PFMS_TREASURY_API_KEY = "test-only-not-a-secret"; // gitleaks:allow
    isEnabled.mockReturnValue(false);
    const body = (await get()).json();
    expect(body).toMatchObject({ agencyCode: "AG01", paymentRail: "disabled", treasuryMode: "live" });

    // adapter enabled, treasury env absent => rail is live, treasury is sandbox
    delete process.env.PFMS_TREASURY_BASE_URL;
    delete process.env.PFMS_TREASURY_API_KEY;
    isEnabled.mockReturnValue(true);
    expect((await get()).json()).toMatchObject({ paymentRail: "live", treasuryMode: "sandbox" });
  });

  it("treasury mode is live only when BOTH base URL and key are set", async () => {
    process.env.PFMS_TREASURY_BASE_URL = "https://pfms.example.test";
    expect((await get()).json().treasuryMode).toBe("sandbox");
    process.env.PFMS_TREASURY_API_KEY = "test-only-not-a-secret"; // gitleaks:allow
    expect((await get()).json().treasuryMode).toBe("live");
  });

  it("never reports the adapter route as sandbox/simulated, and still answers with no tenant config row", async () => {
    getTenantConfig.mockResolvedValue(null);
    for (const enabled of [true, false]) {
      isEnabled.mockReturnValue(enabled);
      const body = (await get()).json();
      expect(["live", "disabled"]).toContain(body.paymentRail);
      expect(body).not.toHaveProperty("mode");
      expect(body).toMatchObject({ agencyCode: null, defaultDdo: null });
    }
  });
});
