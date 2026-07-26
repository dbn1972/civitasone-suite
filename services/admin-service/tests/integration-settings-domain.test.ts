/**
 * integration-settings — pure domain unit tests (no DB, no network).
 * Covers secret splitting/sealing, masking, maker-checker + version guards,
 * and per-provider schema validation.
 */
import { describe, it, expect, beforeAll } from "vitest";

process.env.CONFIG_ENC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const domain = await import("../src/modules/integration-settings/domain.js");
const { REGISTRY, PROVIDERS, isProvider, isEnvScope } = await import("../src/modules/integration-settings/providers.js");

describe("providers registry", () => {
  it("every provider declares its secret fields and a primary secret in its schema", () => {
    for (const p of PROVIDERS) {
      const def = REGISTRY[p];
      expect(def.secretFields.length).toBeGreaterThan(0);
      expect(def.secretFields).toContain(def.primarySecret);
      expect(typeof def.test).toBe("function");
    }
  });
  it("isProvider / isEnvScope guards", () => {
    expect(isProvider("ai_anthropic")).toBe(true);
    expect(isProvider("nope")).toBe(false);
    expect(isEnvScope("prod")).toBe(true);
    expect(isEnvScope("production")).toBe(false);
  });
});

describe("validateAndSplit", () => {
  it("splits secret fields out of config for ai_anthropic", () => {
    const { config, secrets } = domain.validateAndSplit("ai_anthropic", { apiKey: "sk-ant-abcdefghij", model: "m", baseUrl: "https://api.anthropic.com" });
    expect(secrets.apiKey).toBe("sk-ant-abcdefghij");
    expect(config.apiKey).toBeUndefined();
    expect(config.model).toBe("m");
  });
  it("throws 400 INVALID_PROVIDER_CONFIG on a schema violation", () => {
    expect(() => domain.validateAndSplit("sms_twilio", { accountSid: "x" })).toThrowError(/invalid sms_twilio config/);
    try { domain.validateAndSplit("sms_twilio", { accountSid: "x" }); } catch (e) {
      expect((e as { status: number; code: string }).status).toBe(400);
      expect((e as { code: string }).code).toBe("INVALID_PROVIDER_CONFIG");
    }
  });
});

describe("secret sealing + masking (AES-256-GCM round-trip)", () => {
  it("seals then opens a secret bundle", () => {
    const { ciphertext } = domain.sealSecrets({ apiKey: "sk-ant-TOPSECRET" });
    expect(ciphertext).toContain("v1:");
    expect(ciphertext).not.toContain("TOPSECRET");
    const opened = domain.openSecrets(ciphertext);
    expect(opened.apiKey).toBe("sk-ant-TOPSECRET");
  });
  it("an empty bundle seals to null ciphertext", () => {
    expect(domain.sealSecrets({}).ciphertext).toBeNull();
  });
  it("primaryLast4 + maskLast4 render ••••1234", () => {
    const last4 = domain.primaryLast4("ai_anthropic", { apiKey: "sk-ant-xxxx1234" });
    expect(last4).toBe("1234");
    expect(domain.maskLast4(last4)).toBe("••••1234");
    expect(domain.maskLast4(null)).toBeNull();
  });
});

describe("guards", () => {
  it("assertApproverDistinct blocks self-approval", () => {
    expect(() => domain.assertApproverDistinct("u1", "u1")).toThrowError(/approver must differ/);
    expect(() => domain.assertApproverDistinct("u1", "u2")).not.toThrow();
  });
  it("assertPending only allows pending", () => {
    expect(() => domain.assertPending("approved")).toThrow();
    expect(() => domain.assertPending("pending")).not.toThrow();
  });
  it("assertVersionMatch enforces optimistic concurrency", () => {
    expect(() => domain.assertVersionMatch(3, 5)).toThrowError(/stale version/);
    expect(() => domain.assertVersionMatch(undefined, 5)).not.toThrow();
    expect(() => domain.assertVersionMatch(5, 5)).not.toThrow();
  });
});

describe("provider test() fail-closed guards (no network)", () => {
  it("every provider's test() returns status=failed when nothing is configured", async () => {
    for (const p of PROVIDERS) {
      const r = await REGISTRY[p].test({ config: {}, secrets: {}, endpointUrl: "" });
      expect(r.ok).toBe(false);
      expect(r.status).toBe("failed");
      expect(r.error).toBeTruthy();
    }
  });
  it("payment_upi with credentials but no endpoint does NOT fake a success", async () => {
    const r = await REGISTRY.payment_upi.test({ config: { vpa: "a@bank" }, secrets: { key: "keykey" }, endpointUrl: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unverified/);
  });
});

describe("sealSecrets fail-closed", () => {
  it("throws ENCRYPTION_UNAVAILABLE when no key is configured", async () => {
    const prev = process.env.CONFIG_ENC_KEY;
    delete process.env.CONFIG_ENC_KEY;
    try {
      expect(() => domain.sealSecrets({ apiKey: "x" })).toThrowError(/CONFIG_ENC_KEY is not configured/);
    } finally {
      process.env.CONFIG_ENC_KEY = prev;
    }
  });
});
