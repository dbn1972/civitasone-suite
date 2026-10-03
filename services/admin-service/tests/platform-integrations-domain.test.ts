/**
 * platform-integrations — pure domain + secret-crypto tests (no DB).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  IntegrationError,
  assertDeciderDistinct,
  assertProductionEligible,
  assertVersion,
  fieldActive,
  inactiveSecretKeys,
  isAvailableToTenant,
  maskedSecrets,
  missingRequired,
  parseFields,
  sensitiveKeys,
  touchesSensitive,
  validateRecordInput,
  type ConfigField,
} from "../src/modules/platform-integrations/domain.js";
import { canUseCategory, rolesForCategory } from "../src/modules/platform-integrations/roles.js";
import {
  SecretDecryptError,
  SecretKeyUnavailableError,
  isSealed,
  openSecret,
  sealSecret,
  secretKeyConfigured,
} from "../src/shared/secret-crypto.js";

const FIELDS: ConfigField[] = parseFields({
  fields: [
    { key: "channel", label: "Channel", type: "select", required: true, secret: false, options: [{ value: "api", label: "API" }, { value: "sftp_h2h", label: "SFTP" }], default: "api" },
    { key: "corporateId", label: "Corporate ID", type: "text", required: true, secret: false, maxLength: 8 },
    { key: "apiKey", label: "API key", type: "text", required: true, secret: true, showWhen: { field: "channel", equals: "api" } },
    { key: "sftpHost", label: "SFTP host", type: "text", required: true, secret: false, showWhen: { field: "channel", equals: "sftp_h2h" } },
    { key: "sftpPrivateKey", label: "SFTP key", type: "multiline", required: true, secret: true, showWhen: { field: "channel", equals: "sftp_h2h" } },
    { key: "port", label: "Port", type: "number", required: false, secret: false, min: 1, max: 65535 },
    { key: "callbackUrl", label: "Callback", type: "url", required: false, secret: false },
    { key: "prodOnly", label: "Prod only", type: "text", required: true, secret: false, environments: ["production"] },
    { key: "keyRef", label: "Key ref", type: "keyRef", required: false, secret: false, pattern: "^[A-Za-z0-9._:/-]{1,128}$" },
  ],
});

function expectFieldErrors(fn: () => unknown, fields: string[]) {
  try {
    fn();
    throw new Error("expected IntegrationError");
  } catch (e) {
    expect(e).toBeInstanceOf(IntegrationError);
    const ie = e as IntegrationError;
    expect(ie.status).toBe(400);
    expect(ie.fieldErrors?.map((f) => f.field).sort()).toEqual([...fields].sort());
  }
}

describe("parseFields", () => {
  it("drops malformed entries instead of trusting them", () => {
    expect(parseFields({ fields: [{ key: "ok", label: "x", type: "text" }, { key: "9bad", label: "x", type: "text" }, { nope: true }] })).toHaveLength(1);
    expect(parseFields(null)).toEqual([]);
    expect(parseFields({ fields: "x" })).toEqual([]);
  });
  it("defaults environments to both and required/secret to false", () => {
    const [f] = parseFields({ fields: [{ key: "a", label: "A", type: "text" }] });
    expect(f?.environments).toEqual(["sandbox", "production"]);
    expect(f?.required).toBe(false);
    expect(f?.secret).toBe(false);
  });
});

describe("validateRecordInput", () => {
  it("splits config from secrets and normalises numbers", () => {
    const r = validateRecordInput(FIELDS, { config: { channel: "api", corporateId: " ABC ", port: "22" }, secrets: { apiKey: "k-123" } });
    expect(r.config).toEqual({ channel: "api", corporateId: "ABC", port: 22 });
    expect(r.secrets).toEqual({ apiKey: "k-123" });
  });
  it("rejects unknown fields, secrets sent as config and plain fields sent as secrets", () => {
    expectFieldErrors(() => validateRecordInput(FIELDS, { config: { nope: "x", apiKey: "leak" }, secrets: { corporateId: "x" } }), ["nope", "apiKey", "corporateId"]);
  });
  it("enforces type, option, length, pattern, url and range rules", () => {
    expectFieldErrors(() => validateRecordInput(FIELDS, {
      config: { channel: "ftp", corporateId: "123456789", port: 70000, callbackUrl: "http://insecure.example", keyRef: "bad key!" },
      secrets: {},
    }), ["channel", "corporateId", "port", "callbackUrl", "keyRef"]);
  });
  it("treats blank config as unset and a blank secret as 'keep existing'", () => {
    const r = validateRecordInput(FIELDS, { config: { channel: "api", corporateId: "" }, secrets: { apiKey: "" } });
    expect(r.config).toEqual({ channel: "api" });
    expect(r.secrets).toEqual({});
  });
  it("drops values of fields hidden by showWhen", () => {
    const r = validateRecordInput(FIELDS, { config: { channel: "api", sftpHost: "h.example" }, secrets: {} });
    expect(r.config).toEqual({ channel: "api" });
  });
});

describe("completeness per environment", () => {
  it("requires secrets to be present, only for the active branch and the target environment", () => {
    expect(missingRequired(FIELDS, "sandbox", { channel: "api", corporateId: "X" }, [])).toEqual(["apiKey"]);
    expect(missingRequired(FIELDS, "sandbox", { channel: "api", corporateId: "X" }, ["apiKey"])).toEqual([]);
    // production-only field is required for production but not sandbox
    expect(missingRequired(FIELDS, "production", { channel: "api", corporateId: "X" }, ["apiKey"])).toEqual(["prodOnly"]);
    expect(missingRequired(FIELDS, "sandbox", { channel: "sftp_h2h", corporateId: "X" }, [])).toEqual(["sftpHost", "sftpPrivateKey"]);
  });
  it("showWhen follows the controlling field", () => {
    const f = FIELDS.find((x) => x.key === "apiKey") as ConfigField;
    expect(fieldActive(f, { channel: "api" })).toBe(true);
    expect(fieldActive(f, { channel: "sftp_h2h" })).toBe(false);
  });
  it("lists stored secrets that went inactive so they can be cleared", () => {
    expect(inactiveSecretKeys(FIELDS, { channel: "sftp_h2h" }, ["apiKey", "sftpPrivateKey"])).toEqual(["apiKey"]);
  });
});

describe("availability and production eligibility", () => {
  const base = { status: "available", availabilityMode: "all", allowedTenantIds: [] as string[], allowedEditions: [] as string[] };
  it("disabled is never available; 'all' is available to everyone", () => {
    expect(isAvailableToTenant({ ...base, status: "disabled" }, "t1", "psu")).toBe(false);
    expect(isAvailableToTenant(base, "t1", null)).toBe(true);
  });
  it("restricted allows an allow-listed tenant OR a matching edition only", () => {
    const p = { ...base, availabilityMode: "restricted", allowedTenantIds: ["t1"], allowedEditions: ["psu"] };
    expect(isAvailableToTenant(p, "t1", "govt_dept")).toBe(true);
    expect(isAvailableToTenant(p, "t2", "psu")).toBe(true);
    expect(isAvailableToTenant(p, "t2", "govt_dept")).toBe(false);
    expect(isAvailableToTenant(p, "t2", null)).toBe(false);
  });
  it("beta is sandbox-only and disabled is refused", () => {
    expect(() => assertProductionEligible("available")).not.toThrow();
    expect(() => assertProductionEligible("beta")).toThrow(/sandbox/);
    expect(() => assertProductionEligible("disabled")).toThrow(/disabled/);
  });
});

describe("guards and masking", () => {
  it("maker != checker", () => {
    expect(() => assertDeciderDistinct("a", "a")).toThrow(IntegrationError);
    expect(() => assertDeciderDistinct("a", "b")).not.toThrow();
  });
  it("optimistic version", () => {
    expect(() => assertVersion(2, 3)).toThrow(/stale/);
    expect(() => assertVersion(3, 3)).not.toThrow();
  });
  it("masking never exposes the sealed value", () => {
    const m = maskedSecrets(FIELDS, { apiKey: "enc:v2:k1:AAAA" });
    expect(JSON.stringify(m)).not.toContain("enc:v2");
    expect(m.find((s) => s.key === "apiKey")).toMatchObject({ set: true, masked: "••••••••" });
    expect(m.find((s) => s.key === "sftpPrivateKey")).toMatchObject({ set: false, masked: null });
  });
});

describe("secret-crypto (keyring envelope)", () => {
  const KEY = process.env.PII_ENC_KEY;
  const KEYID = process.env.PII_KEY_ID;
  const RING = process.env.PII_ENC_KEYRING;
  beforeEach(() => {
    process.env.PII_ENC_KEY = "test-master-key-for-admin-secrets-1"; // gitleaks:allow
    delete process.env.PII_KEY_ID;
    delete process.env.PII_ENC_KEYRING;
  });
  const restore = () => {
    if (KEY === undefined) delete process.env.PII_ENC_KEY; else process.env.PII_ENC_KEY = KEY;
    if (KEYID === undefined) delete process.env.PII_KEY_ID; else process.env.PII_KEY_ID = KEYID;
    if (RING === undefined) delete process.env.PII_ENC_KEYRING; else process.env.PII_ENC_KEYRING = RING;
  };

  it("round-trips, produces a fresh IV each time and never contains the plaintext", () => {
    const a = sealSecret("s3cret-value"); // gitleaks:allow
    const b = sealSecret("s3cret-value"); // gitleaks:allow
    expect(a).not.toEqual(b);
    expect(a.startsWith("enc:v2:k1:")).toBe(true);
    expect(a).not.toContain("s3cret-value"); // gitleaks:allow
    expect(openSecret(a)).toBe("s3cret-value"); // gitleaks:allow
    restore();
  });
  it("rejects plaintext and tampered envelopes (no pass-through)", () => {
    expect(() => openSecret("plain-text")).toThrow(SecretDecryptError);
    const sealed = sealSecret("x");
    const tampered = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => openSecret(tampered)).toThrow(SecretDecryptError);
    expect(isSealed(sealed)).toBe(true);
    restore();
  });
  it("fails closed with no key", () => {
    delete process.env.PII_ENC_KEY;
    expect(secretKeyConfigured()).toBe(false);
    expect(() => sealSecret("x")).toThrow(SecretKeyUnavailableError);
    restore();
  });
  it("keeps old ciphertext readable after key rotation via the keyring", () => {
    const old = sealSecret("rotate-me");
    process.env.PII_ENC_KEYRING = JSON.stringify({ k1: "test-master-key-for-admin-secrets-1" }); // gitleaks:allow
    process.env.PII_ENC_KEY = "a-brand-new-master-key-value-2"; // gitleaks:allow
    process.env.PII_KEY_ID = "k2";
    expect(sealSecret("fresh").startsWith("enc:v2:k2:")).toBe(true);
    expect(openSecret(old)).toBe("rotate-me");
    restore();
  });
});

describe("sensitive fields", () => {
  const marked = parseFields({ fields: [
    { key: "endpoint", label: "E", type: "url", sensitive: true },
    { key: "label", label: "L", type: "text" },
    { key: "token", label: "T", type: "text", secret: true },
  ] });
  it("only marked fields and secrets are sensitive when the schema marks any", () => {
    expect([...sensitiveKeys(marked)].sort()).toEqual(["endpoint", "token"]);
  });
  it("with nothing marked, every field is sensitive (fail closed)", () => {
    const unmarked = parseFields({ fields: [{ key: "a", label: "A", type: "text" }, { key: "b", label: "B", type: "text" }] });
    expect([...sensitiveKeys(unmarked)].sort()).toEqual(["a", "b"]);
  });
  it("touchesSensitive: secret write/clear and sensitive value changes count; label and enabled-only edits do not", () => {
    const before = { endpoint: "https://a.example", label: "x" };
    expect(touchesSensitive(marked, before, { ...before, label: "y" }, [], [])).toBe(false);
    expect(touchesSensitive(marked, before, before, ["token"], [])).toBe(true);
    expect(touchesSensitive(marked, before, before, [], ["token"])).toBe(true);
    expect(touchesSensitive(marked, before, { ...before, endpoint: "https://b.example" }, [], [])).toBe(true);
    expect(touchesSensitive(marked, {}, { endpoint: "https://b.example" }, [], [])).toBe(true);
  });
});

describe("category-scoped roles", () => {
  it("bank_api and pfms include finance/payroll admins; esign and dsc do not", () => {
    for (const c of ["bank_api", "pfms"] as const) {
      expect(canUseCategory(c, ["finance_admin"])).toBe(true);
      expect(canUseCategory(c, ["payroll_admin"])).toBe(true);
      expect(canUseCategory(c, ["tenant_admin"])).toBe(true);
    }
    for (const c of ["esign", "dsc"] as const) {
      expect(canUseCategory(c, ["finance_admin"])).toBe(false);
      expect(canUseCategory(c, ["payroll_admin"])).toBe(false);
      expect(canUseCategory(c, ["tenant_admin"])).toBe(true);
      expect(canUseCategory(c, ["super_admin"])).toBe(true);
      expect(canUseCategory(c, ["platform_admin"])).toBe(true);
    }
    expect(canUseCategory("bank_api", [])).toBe(false);
    expect(rolesForCategory("esign")).not.toContain("officer");
  });
});
