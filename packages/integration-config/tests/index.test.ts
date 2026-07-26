import { describe, it, expect, afterEach } from "vitest";
import { resolveIntegration, registryEnabled, closeIntegrationConfig } from "../src/index.js";

afterEach(async () => {
  delete process.env.INTEGRATION_REGISTRY_DB_URL;
  await closeIntegrationConfig();
});

describe("integration-config resolver — backward-compatible fallback", () => {
  it("registryEnabled is false when INTEGRATION_REGISTRY_DB_URL is unset", () => {
    delete process.env.INTEGRATION_REGISTRY_DB_URL;
    expect(registryEnabled()).toBe(false);
  });

  it("resolveIntegration returns null (→ env fallback) when the registry is not wired", async () => {
    delete process.env.INTEGRATION_REGISTRY_DB_URL;
    const r = await resolveIntegration({ provider: "sms_twilio", tenantId: "t-1" });
    expect(r).toBeNull();
  });

  it("resolveIntegration returns null when tenantId is empty even if wired", async () => {
    process.env.INTEGRATION_REGISTRY_DB_URL = "postgres://localhost:5999/none";
    const r = await resolveIntegration({ provider: "sms_twilio", tenantId: "" });
    expect(r).toBeNull();
  });
});
