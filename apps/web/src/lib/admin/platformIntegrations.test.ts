import { describe, it, expect } from "vitest";
import {
  buildSaveBody,
  byCategory,
  canRequestProduction,
  editTouchesSensitive,
  sensitiveKeySet,
  fieldVisible,
  initialValues,
  isEmptyList,
  missingForEnv,
  personLabel,
  pollUntil,
  providerStatusTone,
  recordFor,
  type FieldDef,
  type TenantRecord,
} from "./platformIntegrations";

const FIELDS: FieldDef[] = [
  { key: "channel", label: "Channel", type: "select", required: true, secret: false, environments: ["sandbox", "production"], options: [{ value: "api", label: "API" }, { value: "sftp_h2h", label: "SFTP" }], default: "api" },
  { key: "corporateId", label: "Corporate ID", type: "text", required: true, secret: false, environments: ["sandbox", "production"] },
  { key: "apiKey", label: "API key", type: "text", required: true, secret: true, environments: ["sandbox", "production"], showWhen: { field: "channel", equals: "api" } },
  { key: "sftpHost", label: "SFTP host", type: "text", required: true, secret: false, environments: ["sandbox", "production"], showWhen: { field: "channel", equals: "sftp_h2h" } },
  { key: "port", label: "Port", type: "number", required: false, secret: false, environments: ["sandbox", "production"] },
  { key: "dryRun", label: "Dry run", type: "boolean", required: false, secret: false, environments: ["sandbox"], default: true },
  { key: "prodOnly", label: "Prod only", type: "text", required: true, secret: false, environments: ["production"] },
];

describe("schema-driven form helpers", () => {
  it("seeds defaults for a new record but never overwrites stored config, and never seeds secrets", () => {
    const fresh = initialValues(FIELDS, undefined);
    expect(fresh).toMatchObject({ channel: "api", corporateId: "", port: "", dryRun: true });
    expect("apiKey" in fresh).toBe(false);
    const stored = initialValues(FIELDS, { channel: "sftp_h2h", corporateId: "C1", port: 22, dryRun: false });
    expect(stored).toMatchObject({ channel: "sftp_h2h", corporateId: "C1", port: "22", dryRun: false });
  });

  it("showWhen controls visibility", () => {
    const apiKey = FIELDS.find((f) => f.key === "apiKey") as FieldDef;
    expect(fieldVisible(apiKey, { channel: "api" })).toBe(true);
    expect(fieldVisible(apiKey, { channel: "sftp_h2h" })).toBe(false);
  });

  it("buildSaveBody omits hidden fields and blank secrets, sends numbers as numbers, and carries expectedVersion only on update", () => {
    const values = { channel: "api", corporateId: " C1 ", sftpHost: "stale.example", port: "22", dryRun: true, prodOnly: "" };
    const create = buildSaveBody({ fields: FIELDS, values, secretInputs: { apiKey: "k-1" }, clearSecrets: [], enabled: true }); // gitleaks:allow
    expect(create).toEqual({ config: { channel: "api", corporateId: "C1", port: 22, dryRun: true }, secrets: { apiKey: "k-1" }, clearSecrets: [], enabled: true }); // gitleaks:allow
    expect("expectedVersion" in create).toBe(false);
    const update = buildSaveBody({ fields: FIELDS, values, secretInputs: { apiKey: "" }, clearSecrets: ["apiKey"], enabled: false, expectedVersion: 3 });
    expect(update).toMatchObject({ secrets: {}, clearSecrets: ["apiKey"], enabled: false, expectedVersion: 3 });
    // a secret being set wins over a clear request for the same field
    const both = buildSaveBody({ fields: FIELDS, values, secretInputs: { apiKey: "new" }, clearSecrets: ["apiKey"], enabled: true });
    expect(both.clearSecrets).toEqual([]);
  });

  it("missingForEnv mirrors the server's completeness rules", () => {
    const values = { channel: "api", corporateId: "C1", prodOnly: "" };
    expect(missingForEnv(FIELDS, "sandbox", values, [])).toEqual(["apiKey"]);
    expect(missingForEnv(FIELDS, "sandbox", values, ["apiKey"])).toEqual([]);
    expect(missingForEnv(FIELDS, "production", values, ["apiKey"])).toEqual(["prodOnly"]);
    // a secret being cleared no longer counts; a secret being typed does
    expect(missingForEnv(FIELDS, "sandbox", values, ["apiKey"], {}, ["apiKey"])).toEqual(["apiKey"]);
    expect(missingForEnv(FIELDS, "sandbox", values, [], { apiKey: "typed" })).toEqual([]);
  });
});

describe("records and lists", () => {
  const rec = (over: Partial<TenantRecord>): TenantRecord => ({
    id: "1", providerKey: "p", category: "esign", providerName: "P", providerStatus: "available", environment: "sandbox", enabled: true,
    config: {}, secrets: [], missingRequired: { sandbox: [], production: [] },
    health: { status: "untested", code: null, message: null, testedAt: null, environment: null }, version: 1, updatedAt: null, ...over,
  });

  it("canRequestProduction needs sandbox, an available provider, no pending request and no missing production fields", () => {
    expect(canRequestProduction(rec({}))).toBe(true);
    expect(canRequestProduction(rec({ environment: "production" }))).toBe(false);
    expect(canRequestProduction(rec({ providerStatus: "beta" }))).toBe(false);
    expect(canRequestProduction(rec({ missingRequired: { sandbox: [], production: ["prodOnly"] } }))).toBe(false);
    expect(canRequestProduction(rec({ pendingSwitch: { id: "r", providerKey: "p", status: "pending", reason: "x", requestedBy: "u", requestedAt: null, decidedBy: null, decidedAt: null, decisionNote: null, direct: false } }))).toBe(false);
  });

  it("groups and finds", () => {
    const rows = [rec({ providerKey: "a", category: "esign" }), rec({ providerKey: "b", category: "dsc" })];
    expect(byCategory(rows, "dsc").map((r) => r.providerKey)).toEqual(["b"]);
    expect(recordFor(rows, "a")?.providerKey).toBe("a");
    expect(recordFor(rows, "zz")).toBeUndefined();
    expect(isEmptyList([])).toBe(true);
    expect(isEmptyList([1])).toBe(false);
  });

  it("never shows a raw actor id", () => {
    expect(personLabel("u1", "u1", {}, "You", "Another")).toBe("You");
    expect(personLabel("u2", "u1", { u2: "Asha Rao" }, "You", "Another")).toBe("Asha Rao");
    expect(personLabel("u3", "u1", {}, "You", "Another")).toBe("Another");
    expect(personLabel("u3", null, { u3: "  " }, "You", "Another")).toBe("Another");
  });

  it("status tones", () => {
    expect(providerStatusTone("available")).toBe("good");
    expect(providerStatusTone("beta")).toBe("warn");
    expect(providerStatusTone("disabled")).toBe("mut");
  });
});

describe("pollUntil", () => {
  const noSleep = async () => {};
  it("resolves as soon as the condition holds", async () => {
    let n = 0;
    const r = await pollUntil(async () => ++n, (v) => v >= 3, { sleep: noSleep });
    expect(r).toEqual({ value: 3, settled: true });
  });
  it("gives up after the bounded number of tries and reports unsettled", async () => {
    let n = 0;
    const r = await pollUntil(async () => { n++; return 0; }, (v) => v > 0, { tries: 4, sleep: noSleep });
    expect(r.settled).toBe(false);
    expect(n).toBe(4);
  });
  it("tolerates failed reads (null) without throwing", async () => {
    const r = await pollUntil<number>(async () => null, () => true, { tries: 2, sleep: noSleep });
    expect(r).toEqual({ value: null, settled: false });
  });
});

describe("sensitive-edit warning helpers", () => {
  const f = (o: Partial<FieldDef> & { key: string }): FieldDef => ({ label: o.key, type: "text", required: false, secret: false, environments: ["sandbox", "production"], ...o });
  const marked = [f({ key: "endpoint", sensitive: true }), f({ key: "label" }), f({ key: "token", secret: true })];
  it("marks secrets and flagged fields; with nothing flagged every field counts", () => {
    expect([...sensitiveKeySet(marked)].sort()).toEqual(["endpoint", "token"]);
    expect([...sensitiveKeySet([f({ key: "a" }), f({ key: "b" })])].sort()).toEqual(["a", "b"]);
  });
  it("editTouchesSensitive: secrets and flagged fields yes, an unflagged field no", () => {
    const stored = { endpoint: "https://a.example", label: "x" };
    const values = { endpoint: "https://a.example", label: "x" };
    expect(editTouchesSensitive(marked, stored, values, {}, [])).toBe(false);
    expect(editTouchesSensitive(marked, stored, { ...values, label: "y" }, {}, [])).toBe(false);
    expect(editTouchesSensitive(marked, stored, { ...values, endpoint: "https://b.example" }, {}, [])).toBe(true);
    expect(editTouchesSensitive(marked, stored, values, { token: "new" }, [])).toBe(true);
    expect(editTouchesSensitive(marked, stored, values, {}, ["token"])).toBe(true);
  });
});
