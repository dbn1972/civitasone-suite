/** Direction-aware change control for settings + scan profiles: tighten = immediate, loosen = super_admin second approver (real DB). */
import { describe, it, expect, afterAll, beforeAll, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerBulkScanConsumers } from "../src/modules/bulk-scan/consumer.js";
import * as repo from "../src/modules/bulk-scan/repo.js";
import { COMMANDS } from "../src/topics.js";
import { DEFAULT_SETTINGS, isSensitiveChange } from "../src/modules/bulk-scan/settings.js";
import { classifyChange, classifyProfileChange, settingsApplyDirectly, canonicalJson } from "../src/modules/bulk-scan/change-classifier.js";
import type { BulkScanSettings } from "../src/modules/bulk-scan/validators.js";
import { newInline, send, USER1, USER2, USER3, newTenant, insertBatchRow, putSettings } from "./bulk-scan-helpers.js";
import { auditsOf } from "./bulk-scan-review-helpers.js";

const SECRET = process.env.JWT_SECRET as string;
const P = "/v1/documents/bulk-scan";
const hdr = (sub: string, roles: string[], tid: string) => ({ authorization: `Bearer ${signToken({ sub, roles, tid } as never, SECRET)}`, "x-tenant-id": tid });
const admin = (t: string, sub = USER1) => hdr(sub, ["document_admin"], t);
const superAdmin = (t: string, sub = USER2) => hdr(sub, ["super_admin"], t);

let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;
const { q } = newInline();
beforeAll(async () => {
  registerBulkScanConsumers(queue);
  app = await (await import("../src/app.js")).buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, h: Record<string, string>, payload?: unknown) => {
  const r = await app.inject({ method, url, headers: h, ...(payload === undefined ? {} : { payload: payload as never }) });
  await queue.drain();
  return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
};
const inT = <T>(t: string, f: () => Promise<T>): Promise<T> => runWithTenant(t, f) as Promise<T>;
const profilesOf = async (t: string) => (await call("GET", `${P}/profiles`, admin(t))).body.data as { id: string; name: string; version: number; config: Record<string, unknown> }[];
const settingsOf = async (t: string) => (await call("GET", `${P}/settings`, admin(t))).body as { settings: BulkScanSettings; version: number };

// ── classifier (pure, table driven) ─────────────────────────────
const S = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ ...DEFAULT_SETTINGS, ...o });
const chain = (...ids: string[]) => ids.map((id) => ({ id, timeoutMs: 120_000 }));
const dir = (o: Record<string, unknown>, n: Record<string, unknown>) => classifyChange(o, n).direction;
const WITH_CLOUD = S({ providerChain: chain("tesseract", "google_docai") });
const pii = (policy: Record<string, string>, reviewOnDetect = false) => S({ pii: { policy: { ...DEFAULT_SETTINGS.pii.policy, ...policy }, reviewOnDetect } });

describe("classifyChange: provider chain is ORDERED (the first provider gets every page)", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
    ["[tesseract, google_docai] -> [google_docai] (tesseract removed, cloud primary)", WITH_CLOUD, S({ providerChain: chain("google_docai") }), "loosen"],
    ["[tesseract, google_docai] -> [google_docai, tesseract] (cloud first)", WITH_CLOUD, S({ providerChain: chain("google_docai", "tesseract") }), "loosen"],
    ["[tesseract, google, aws] -> [tesseract, aws] (cloud removed, order kept)", S({ providerChain: chain("tesseract", "google_docai", "aws_textract") }), S({ providerChain: chain("tesseract", "aws_textract") }), "tighten"],
    ["[tesseract, google, aws] -> [tesseract]", S({ providerChain: chain("tesseract", "google_docai", "aws_textract") }), S({ providerChain: chain("tesseract") }), "tighten"],
    ["[tesseract, google, aws] -> [tesseract, aws, google] (cloud reorder, same primary)", S({ providerChain: chain("tesseract", "google_docai", "aws_textract") }), S({ providerChain: chain("tesseract", "aws_textract", "google_docai") }), "loosen"],
    ["[google, tesseract] -> [tesseract] (primary becomes local)", S({ providerChain: chain("google_docai", "tesseract") }), S({ providerChain: chain("tesseract") }), "tighten"],
    ["[google, aws] -> [aws] (primary changes to another cloud)", S({ providerChain: chain("google_docai", "aws_textract") }), S({ providerChain: chain("aws_textract") }), "loosen"],
    ["[google, aws] -> [google] (same primary, fallback dropped)", S({ providerChain: chain("google_docai", "aws_textract") }), S({ providerChain: chain("google_docai") }), "tighten"],
    ["[tesseract] -> [tesseract, google]", S(), WITH_CLOUD, "loosen"],
    ["[google] -> [aws] (cloud swapped for another cloud)", S({ providerChain: chain("google_docai") }), S({ providerChain: chain("aws_textract") }), "loosen"],
    ["[tesseract, google] -> [google, tesseract] timeouts irrelevant: order matters", WITH_CLOUD, S({ providerChain: [{ id: "google_docai", timeoutMs: 5_000 }, { id: "tesseract", timeoutMs: 1_000 }] }), "loosen"],
    ["same ids, same order, other timeouts: neutral", WITH_CLOUD, S({ providerChain: [{ id: "tesseract", timeoutMs: 5_000 }, { id: "google_docai", timeoutMs: 9_000 }] }), "neutral"],
    ["empty / malformed chain is never tightening", WITH_CLOUD, S({ providerChain: [] }), "loosen"],
  ];
  it.each(cases)("%s -> %s", (_n, o, n, want) => { expect(dir(o, n)).toBe(want); });
});

describe("classifyChange: every other key, both directions (table driven)", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
    ["reviewThreshold up", S(), S({ reviewThreshold: 0.9 }), "tighten"],
    ["reviewThreshold down", S(), S({ reviewThreshold: 0.5 }), "loosen"],
    ["failClosed ON", S({ malwareFailClosed: false }), S(), "tighten"],
    ["failClosed OFF", S(), S({ malwareFailClosed: false }), "loosen"],
    ["filingMakerChecker ON", S({ filingMakerChecker: false }), S(), "tighten"],
    ["filingMakerChecker OFF", S(), S({ filingMakerChecker: false }), "loosen"],
    // classification.*: ANY change is sensitive (direction depends on whether a preset doc type is set)
    ["classification.minScore up", S(), S({ classification: { ...DEFAULT_SETTINGS.classification, minScore: 0.99 } }), "loosen"],
    ["classification.minScore down", S(), S({ classification: { ...DEFAULT_SETTINGS.classification, minScore: 0 } }), "loosen"],
    ["classification.uncertainMargin up", S(), S({ classification: { ...DEFAULT_SETTINGS.classification, uncertainMargin: 0.9 } }), "loosen"],
    ["classification.uncertainMargin down", S(), S({ classification: { ...DEFAULT_SETTINGS.classification, uncertainMargin: 0 } }), "loosen"],
    ["classification.uncertainBelow up", S(), S({ classification: { ...DEFAULT_SETTINGS.classification, uncertainBelow: 0.9 } }), "loosen"],
    ["classification.uncertainBelow down", S(), S({ classification: { ...DEFAULT_SETTINGS.classification, uncertainBelow: 0.1 } }), "loosen"],
    ["classification.docTypes edited", S(), S({ classification: { ...DEFAULT_SETTINGS.classification, docTypes: DEFAULT_SETTINGS.classification.docTypes.slice(0, -1).concat([{ id: "other", label: "Misc", keywords: [], requiredFields: [] }]) } }), "loosen"],
    ["defaultDocType (preset) set / changed", S(), S({ defaultDocType: "letter" }), "loosen"],
    ["bestOf enabled", S(), S({ bestOf: { enabled: true, threshold: 0.7 } }), "loosen"],
    ["bestOf disabled", S({ bestOf: { enabled: true, threshold: 0.7 } }), S(), "tighten"],
    ["bestOf.threshold changed while ON", S({ bestOf: { enabled: true, threshold: 0.7 } }), S({ bestOf: { enabled: true, threshold: 0.9 } }), "loosen"],
    ["bestOf.threshold changed while OFF", S(), S({ bestOf: { enabled: false, threshold: 0.9 } }), "neutral"],
    ["pii mask -> flag", pii({ aadhaar: "mask" }), pii({ aadhaar: "flag" }), "loosen"],
    ["pii redact -> mask", pii({ aadhaar: "redact" }), pii({ aadhaar: "mask" }), "loosen"],
    ["pii redact -> flag", pii({ pan: "redact" }), pii({ pan: "flag" }), "loosen"],
    ["pii flag -> mask", pii({ pan: "flag" }), pii({ pan: "mask" }), "tighten"],
    ["pii mask -> redact", pii({ aadhaar: "mask" }), pii({ aadhaar: "redact" }), "tighten"],
    ["pii policy value outside the known ranks (mask -> none)", pii({ aadhaar: "mask" }), pii({ aadhaar: "none" }), "loosen"],
    ["pii.reviewOnDetect off", pii({}, true), pii({}, false), "loosen"],
    ["pii.reviewOnDetect on", pii({}, false), pii({}, true), "tighten"],
    ["duplicatePolicy skip -> keep", S(), S({ duplicatePolicy: "keep" }), "loosen"],
    ["duplicatePolicy keep -> skip", S({ duplicatePolicy: "keep" }), S(), "loosen"],
    ["allowedLinkTargets widened", S({ allowedLinkTargets: ["hr_employee"] }), S({ allowedLinkTargets: ["hr_employee", "finance_voucher"] }), "loosen"],
    ["allowedLinkTargets narrowed", S(), S({ allowedLinkTargets: ["hr_employee"] }), "tighten"],
    ["allowedLinkTargets reordered", S({ allowedLinkTargets: ["hr_employee", "eoffice_file"] }), S({ allowedLinkTargets: ["eoffice_file", "hr_employee"] }), "neutral"],
    ["retentionDaysByType added", S(), S({ retentionDaysByType: { pay_slip: 30 } }), "loosen"],
    ["retentionDaysByType shortened", S({ retentionDaysByType: { pay_slip: 90 } }), S({ retentionDaysByType: { pay_slip: 30 } }), "loosen"],
    ["retentionDaysByType lengthened", S({ retentionDaysByType: { pay_slip: 30 } }), S({ retentionDaysByType: { pay_slip: 90 } }), "loosen"],
    ["nonFiledRetentionDays up", S(), S({ nonFiledRetentionDays: 90 }), "loosen"],
    ["nonFiledRetentionDays down", S(), S({ nonFiledRetentionDays: 7 }), "loosen"],
    ["dpi / languages / concurrency / limits are neutral", S(), S({ dpi: 400, languages: ["eng"], concurrency: 3, maxAttempts: 7, twoDigitYearPivot: 40, limits: { ...DEFAULT_SETTINGS.limits, maxFileBytes: 2048 } }), "neutral"],
    ["no change", S(), S(), "neutral"],
  ];
  it.each(cases)("%s -> %s", (_n, o, n, want) => { expect(dir(o, n)).toBe(want); });

  it("FAIL SAFE: a key the classifier does not know (new / unknown config key) is LOOSEN, at the top level and nested", () => {
    expect(dir(S(), S({ someFutureSetting: true }))).toBe("loosen");
    expect(dir(S({ someFutureSetting: 1 }), S({ someFutureSetting: 2 }))).toBe("loosen");
    expect(dir(S(), S({ pii: { ...DEFAULT_SETTINGS.pii, newPiiKnob: 1 } }))).toBe("loosen");
    expect(dir(S(), S({ bestOf: { ...DEFAULT_SETTINGS.bestOf, newKnob: 1 } }))).toBe("loosen");
    expect(dir(S(), S({ classification: { ...DEFAULT_SETTINGS.classification, newKnob: 1 } }))).toBe("loosen");
    expect(classifyChange(S(), S({ someFutureSetting: true })).fields).toEqual([expect.objectContaining({ path: "someFutureSetting", direction: "loosen" })]);
  });

  it("mixed: any loosening plus any tightening is 'mixed'; the fields carry their own direction and before/after", () => {
    const c = classifyChange(S(), S({ reviewThreshold: 0.95, malwareFailClosed: false }));
    expect(c.direction).toBe("mixed");
    expect(c.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "reviewThreshold", direction: "tighten", before: 0.8, after: 0.95 }),
      expect.objectContaining({ path: "malwareFailClosed", direction: "loosen", before: true, after: false }),
    ]));
  });

  it("settings: only a pure tightening applies directly; a neutral field alongside or a loosening does not", () => {
    expect(settingsApplyDirectly(classifyChange(S(), S({ reviewThreshold: 0.9 })))).toBe(true);
    expect(settingsApplyDirectly(classifyChange(S(), S({ reviewThreshold: 0.9, dpi: 400 })))).toBe(false);
    expect(settingsApplyDirectly(classifyChange(S(), S({ dpi: 400 })))).toBe(false);
    expect(settingsApplyDirectly(classifyChange(S(), S({ reviewThreshold: 0.1 })))).toBe(false);
    expect(settingsApplyDirectly(classifyChange(WITH_CLOUD, S()))).toBe(true);                   // cloud provider dropped
    expect(classifyChange(S(), S({ concurrency: 3 })).fields).toEqual([{ path: "concurrency", direction: "neutral" }]);
  });
  it("isSensitiveChange (reason needed) is unchanged: failClosed / filingMakerChecker OFF only", () => {
    expect(isSensitiveChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, filingMakerChecker: false })).toBe(true);
    expect(isSensitiveChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, reviewThreshold: 0.1 })).toBe(false);
  });
});

describe("key order is irrelevant (canonical comparison); array order still is", () => {
  const rev = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).reverse()) as T;
  const P = DEFAULT_SETTINGS;
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ["providerChain element objects", S({ providerChain: chain("tesseract", "google_docai") }), S({ providerChain: chain("tesseract", "google_docai").map(rev) })],
    ["pii policy map + pii object", S(), S({ pii: rev({ ...P.pii, policy: rev({ ...P.pii.policy }) }) })],
    ["retentionDaysByType", S({ retentionDaysByType: { pay_slip: 30, letter: 60 } }), S({ retentionDaysByType: { letter: 60, pay_slip: 30 } })],
    ["classification object", S(), S({ classification: rev({ ...P.classification }) })],
    ["bestOf object", S({ bestOf: { enabled: true, threshold: 0.7 } }), S({ bestOf: { threshold: 0.7, enabled: true } })],
    ["limits (neutral key)", S(), S({ limits: rev({ ...P.limits }) })],
    ["docTypes element objects", S(), S({ classification: { ...P.classification, docTypes: P.classification.docTypes.map((d) => rev({ ...d })) } })],
    ["unknown key holding an object", S({ future: { a: 1, b: { c: 2, d: 3 } } }), S({ future: { b: { d: 3, c: 2 }, a: 1 } })],
    ["undefined-valued key is dropped", S(), S({ dpi: P.dpi, extra: undefined })],
    ["top-level key order", S(), rev(S())],
  ];
  it.each(cases)("%s: a pure key reorder is NEUTRAL", (_n, o, n) => { expect(classifyChange(o, n)).toEqual({ direction: "neutral", fields: [] }); });
  it("a real change inside a reordered object is still classified", () => {
    expect(dir(S({ providerChain: chain("tesseract") }), S({ providerChain: [rev({ id: "tesseract", timeoutMs: 1 }), rev({ id: "google_docai", timeoutMs: 1 })] }))).toBe("loosen");
    expect(dir(S(), S({ pii: rev({ ...P.pii, policy: rev({ ...P.pii.policy, aadhaar: "flag" }) }) }))).toBe("loosen");
    expect(dir(S({ retentionDaysByType: { a: 1, b: 2 } }), S({ retentionDaysByType: { b: 3, a: 1 } }))).toBe("loosen");
    expect(dir(S({ future: { a: 1 } }), S({ future: { a: 2 } }))).toBe("loosen");
    expect(dir(S(), S({ brandNew: { a: 1 } }))).toBe("loosen");
  });
  it("array ORDER stays significant (providerChain order, plain arrays)", () => {
    expect(dir(S({ providerChain: chain("tesseract", "google_docai") }), S({ providerChain: chain("google_docai", "tesseract") }))).toBe("loosen");
    expect(dir(S({ future: [1, 2] }), S({ future: [2, 1] }))).toBe("loosen");
  });
  it("canonicalJson: sorted keys, array order kept, undefined dropped", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: undefined } })).toBe(canonicalJson({ a: { d: [2, 1] }, b: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("classifyProfileChange (effective values; absent override inherits the tenant value)", () => {
  const T = DEFAULT_SETTINGS;
  const d = (o: Record<string, unknown> | null, n: Record<string, unknown> | null, b: BulkScanSettings = T) => classifyProfileChange(b, o, n).direction;
  it("adding an override: stricter tightens, looser loosens, equal is neutral; provider order matters", () => {
    expect(d(null, { reviewThreshold: 0.9 })).toBe("tighten");
    expect(d(null, { reviewThreshold: 0.5 })).toBe("loosen");
    expect(d(null, { reviewThreshold: 0.8 })).toBe("neutral");
    expect(d(null, { providerChain: chain("tesseract", "aws_textract") })).toBe("loosen");
    expect(d(null, { providerChain: chain("aws_textract") })).toBe("loosen");
    expect(d(null, { dpi: 400, languages: ["eng"], linkDefaults: { target: "hr_employee" } })).toBe("neutral");
  });
  it("a profile cannot disable the classifier cross-check directly: classification overrides, presets and bestOf are all LOOSEN", () => {
    expect(d(null, { classification: { minScore: 1 } })).toBe("loosen");
    expect(d(null, { classification: { minScore: 0 } })).toBe("loosen");
    expect(d(null, { classification: { uncertainMargin: 1 } })).toBe("loosen");
    expect(d(null, { defaultDocType: "letter" })).toBe("loosen");
    expect(d(null, { bestOf: { enabled: true, threshold: 0.5 } })).toBe("loosen");
    expect(d({ defaultDocType: "letter" }, {})).toBe("loosen");                       // removing a preset still changes the cross-check
  });
  it("removing an override reverts to the tenant value and is classified by the RESULT", () => {
    expect(d({ reviewThreshold: 0.5 }, { dpi: 300 })).toBe("tighten");
    expect(d({ reviewThreshold: 0.95 }, { dpi: 300 })).toBe("loosen");
    expect(d({ providerChain: chain("tesseract", "google_docai") }, {})).toBe("tighten");   // reverts to [tesseract]
  });
  it("changing an existing override, mixed combinations, a lax tenant, unknown profile keys", () => {
    expect(d({ reviewThreshold: 0.5 }, { reviewThreshold: 0.6 })).toBe("tighten");
    expect(d({ reviewThreshold: 0.9 }, { reviewThreshold: 0.6 })).toBe("loosen");
    expect(d(null, { reviewThreshold: 0.9, bestOf: { enabled: true, threshold: 0.5 } })).toBe("mixed");
    expect(d(null, { reviewThreshold: 0.6 }, { ...T, reviewThreshold: 0.4 })).toBe("tighten");
    expect(d(null, { futureKnob: 1 })).toBe("loosen");
  });
});

// ── tenant settings over HTTP ───────────────────────────────────
describe("tenant settings: tighten applies immediately, loosen needs a super_admin checker", () => {
  it("raising reviewThreshold applies at once (requiresApproval:false), version bumps, audited with before/after, no change request", async () => {
    const t = newTenant();
    const r = await call("PUT", `${P}/settings`, admin(t), { settings: { reviewThreshold: 0.9 } });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: "accepted", requiresApproval: false });
    expect(await settingsOf(t)).toMatchObject({ version: 1, settings: { reviewThreshold: 0.9 } });
    expect((await call("GET", `${P}/settings/change-requests`, admin(t))).body.data).toEqual([]);
    const [a] = await auditsOf(t, "settings_tightened");
    expect(a?.payload).toMatchObject({ details: { direction: "tighten", before: { reviewThreshold: 0.8 }, after: { reviewThreshold: 0.9 }, version: 1 } });
  });
  it("failClosed back ON and filingMakerChecker back ON apply immediately", async () => {
    const t = newTenant();
    await putSettings(t, { malwareFailClosed: false, filingMakerChecker: false });
    const r = await call("PUT", `${P}/settings`, admin(t), { settings: { malwareFailClosed: true, filingMakerChecker: true } });
    expect(r.body.requiresApproval).toBe(false);
    expect((await settingsOf(t)).settings).toMatchObject({ malwareFailClosed: true, filingMakerChecker: true });
  });
  it("lowering reviewThreshold: change request (requiresApproval:true, sensitive), maker cannot approve, document_admin cannot, other super_admin does", async () => {
    const t = newTenant();
    const r = await call("PUT", `${P}/settings`, admin(t), { settings: { reviewThreshold: 0.3 } });
    expect(r.body.requiresApproval).toBe(true);
    const id = r.body.id as string;
    expect((await settingsOf(t)).settings.reviewThreshold).toBe(0.8);
    expect((await call("GET", `${P}/settings/change-requests?status=pending`, admin(t))).body.data[0]).toMatchObject({ id, sensitive: true });
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, superAdmin(t, USER1), {})).body.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, admin(t, USER2), {})).body.code).toBe("SUPER_ADMIN_REQUIRED");
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, superAdmin(t), {})).status).toBe(202);
    expect((await settingsOf(t)).settings.reviewThreshold).toBe(0.3);
  });
  it("adding a cloud provider needs approval; failClosed OFF still needs a reason (422)", async () => {
    const t = newTenant();
    expect((await call("PUT", `${P}/settings`, admin(t), { settings: { providerChain: chain("tesseract", "google_docai") } })).body.requiresApproval).toBe(true);
    expect((await call("PUT", `${P}/settings`, admin(t), { settings: { malwareFailClosed: false } })).status).toBe(422);
    expect((await call("PUT", `${P}/settings`, admin(t), { settings: { malwareFailClosed: false }, reason: "scanner retired" })).body.requiresApproval).toBe(true);
  });
  it("non-security changes keep today's behaviour (maker-checker, any other admin approves); tighten + neutral together also waits", async () => {
    const t = newTenant();
    const a = await call("PUT", `${P}/settings`, admin(t), { settings: { dpi: 400 } });
    expect(a.body.requiresApproval).toBe(true);
    expect((await call("GET", `${P}/settings/change-requests?status=pending`, admin(t))).body.data[0]).toMatchObject({ sensitive: false });
    const b = await call("PUT", `${P}/settings`, admin(t), { settings: { dpi: 400, reviewThreshold: 0.9 } });
    expect(b.body.requiresApproval).toBe(true);
    expect((await call("POST", `${P}/settings/change-requests/${b.body.id}/approve`, admin(t, USER2), {})).status).toBe(202);
    expect((await settingsOf(t)).settings).toMatchObject({ dpi: 400, reviewThreshold: 0.9 });
  });
  it("an immediate tightening supersedes older pending settings requests", async () => {
    const t = newTenant();
    const pend = (await call("PUT", `${P}/settings`, admin(t), { settings: { dpi: 450 } })).body.id as string;
    await call("PUT", `${P}/settings`, admin(t, USER2), { settings: { reviewThreshold: 0.95 } });
    expect((await call("POST", `${P}/settings/change-requests/${pend}/approve`, admin(t, USER3), {})).body.code).toBe("NOT_PENDING");
  });
  it("bypass: publishing a LOOSENING command directly cannot apply it (consumer re-classifies)", async () => {
    const t = newTenant();
    const id = randomUUID();
    await send(q, COMMANDS.bulkSettingsPropose, t, USER1, { requestId: id, settings: { ...DEFAULT_SETTINGS, reviewThreshold: 0.1 } }, id);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.reviewThreshold).toBe(0.8);
    expect((await inT(t, () => repo.getChangeRequest(t, id)))).toMatchObject({ status: "pending", sensitive: true });
  });
});

// ── profiles over HTTP ──────────────────────────────────────────
describe("profiles", () => {
  it("neutral and tightening profiles are created directly (requiresApproval:false); the audit carries before/after of the changed security fields", async () => {
    const t = newTenant();
    const a = await call("POST", `${P}/profiles`, admin(t), { name: "Letters", config: { dpi: 300, languages: ["eng"] } });
    expect(a.body).toMatchObject({ status: "accepted", requiresApproval: false });
    const b = await call("POST", `${P}/profiles`, admin(t), { name: "Strict", config: { reviewThreshold: 0.95 } });
    expect(b.body.requiresApproval).toBe(false);
    expect((await profilesOf(t)).map((p) => p.name).sort()).toEqual(["Letters", "Strict"]);
    const audits = await auditsOf(t, "profile_create");
    expect(audits.find((x) => (x.payload.details as { name: string }).name === "Strict")?.payload).toMatchObject({ details: { direction: "tighten", before: { reviewThreshold: 0.8 }, after: { reviewThreshold: 0.95 } } });
    expect((await call("GET", `${P}/settings/change-requests`, admin(t))).body.data).toEqual([]);
  });

  it("a LOOSENING profile creates NO profile until a different super_admin approves (maker cannot; reason optional)", async () => {
    const t = newTenant();
    const c = await call("POST", `${P}/profiles`, admin(t), { name: "Auto file", config: { reviewThreshold: 0.2, providerChain: chain("tesseract", "google_docai") } });
    expect(c.status).toBe(202);
    expect(c.body.requiresApproval).toBe(true);
    const requestId = c.body.id as string;
    expect(await profilesOf(t)).toEqual([]);
    const cr = (await call("GET", `${P}/settings/change-requests?status=pending`, admin(t))).body.data as Record<string, any>[];
    expect(cr[0]).toMatchObject({ id: requestId, kind: "profile", sensitive: true, maker: USER1 });
    expect((await call("POST", `${P}/settings/change-requests/${requestId}/approve`, superAdmin(t, USER1), {})).body.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await call("POST", `${P}/settings/change-requests/${requestId}/approve`, admin(t, USER2), {})).body.code).toBe("SUPER_ADMIN_REQUIRED");
    expect(await profilesOf(t)).toEqual([]);
    expect((await call("POST", `${P}/settings/change-requests/${requestId}/approve`, superAdmin(t), {})).status).toBe(202);
    expect((await profilesOf(t))[0]).toMatchObject({ name: "Auto file", config: { reviewThreshold: 0.2 } });
    expect((await settingsOf(t)).version).toBe(0);                                          // tenant settings untouched
  });

  it("reject leaves no profile", async () => {
    const t = newTenant();
    const id = (await call("POST", `${P}/profiles`, admin(t), { name: "x", config: { reviewThreshold: 0 } })).body.id as string;
    expect((await call("POST", `${P}/settings/change-requests/${id}/reject`, admin(t, USER3), { reason: "not wanted" })).status).toBe(202);
    expect(await profilesOf(t)).toEqual([]);
  });

  it("bypass / stale prediction: a direct create / update / delete command that needs approval becomes a CHANGE REQUEST (nothing applied, nothing silently dropped)", async () => {
    const t = newTenant();
    await send(q, COMMANDS.bulkProfileCreate, t, USER1, { profileId: randomUUID(), name: "sneaky", config: { reviewThreshold: 0 } });
    expect(await profilesOf(t)).toEqual([]);
    await call("POST", `${P}/profiles`, admin(t), { name: "Plain", config: { dpi: 300 } });
    const pid = (await profilesOf(t))[0]?.id as string;
    await send(q, COMMANDS.bulkProfileUpdate, t, USER1, { profileId: pid, expectedVersion: 1, config: { providerChain: chain("google_docai", "tesseract") } });
    await send(q, COMMANDS.bulkProfileUpdate, t, USER1, { profileId: pid, expectedVersion: 1, config: { classification: { minScore: 1 } } });
    expect((await profilesOf(t))[0]).toMatchObject({ version: 1, config: { dpi: 300 } });
    await insertBatchRow(t, { profileId: pid });
    await send(q, COMMANDS.bulkProfileDelete, t, USER1, { profileId: pid });
    expect(await profilesOf(t)).toHaveLength(1);
    const pending = (await call("GET", `${P}/settings/change-requests?status=pending`, admin(t))).body.data as { kind: string; sensitive: boolean; profileChange: { op: string } }[];
    expect(pending.map((r) => r.profileChange.op).sort()).toEqual(["create", "delete", "update", "update"]);
    expect(pending.every((r) => r.kind === "profile" && r.sensitive)).toBe(true);
    expect(await auditsOf(t, "profile_change_requested")).toHaveLength(4);
  });

  it("an ordinary profile create / update with a classifier or preset override needs approval over HTTP", async () => {
    const t = newTenant();
    expect((await call("POST", `${P}/profiles`, admin(t), { name: "cls", config: { classification: { minScore: 1 } } })).body.requiresApproval).toBe(true);
    expect((await call("POST", `${P}/profiles`, admin(t, USER2), { name: "preset", config: { defaultDocType: "letter" } })).body.requiresApproval).toBe(true);
    expect((await call("POST", `${P}/profiles`, admin(t, USER3), { name: "bo", config: { bestOf: { enabled: true, threshold: 0.5 } } })).body.requiresApproval).toBe(true);
    expect(await profilesOf(t)).toEqual([]);
  });

  it("update: tightening / neutral / removing a loosening override is direct; loosening goes through a request; stale version rolls the approval back", async () => {
    const t = newTenant();
    await call("POST", `${P}/profiles`, admin(t), { name: "Plain", config: { dpi: 300 } });
    const pid = (await profilesOf(t))[0]?.id as string;
    expect((await call("PUT", `${P}/profiles/${pid}`, admin(t), { expectedVersion: 1, config: { reviewThreshold: 0.9 } })).body.requiresApproval).toBe(false);   // tighten
    expect((await profilesOf(t))[0]).toMatchObject({ version: 2, config: { reviewThreshold: 0.9 } });
    expect((await call("PUT", `${P}/profiles/${pid}`, admin(t), { expectedVersion: 2, config: { dpi: 400 } })).body.requiresApproval).toBe(true);   // removes a 0.9 override -> inherits 0.8 = loosening
    expect((await call("PUT", `${P}/profiles/${pid}`, admin(t), { expectedVersion: 2, name: "Renamed" })).body.requiresApproval).toBe(false);          // name only
    expect((await profilesOf(t))[0]).toMatchObject({ name: "Renamed", version: 3 });
    // two competing loosening requests on the same version: the second approval is stale and rolls back
    const r1 = await call("PUT", `${P}/profiles/${pid}`, admin(t), { expectedVersion: 3, config: { reviewThreshold: 0.5 } });
    const r2 = await call("PUT", `${P}/profiles/${pid}`, admin(t), { expectedVersion: 3, config: { reviewThreshold: 0.4 } });
    expect(r1.body.requiresApproval && r2.body.requiresApproval).toBe(true);
    expect((await call("POST", `${P}/settings/change-requests/${r1.body.id}/approve`, superAdmin(t), {})).status).toBe(202);
    await call("POST", `${P}/settings/change-requests/${r2.body.id}/approve`, superAdmin(t, USER3), {});
    expect((await profilesOf(t))[0]).toMatchObject({ version: 4, config: { reviewThreshold: 0.5 } });
    // the competing request can never apply: rejected / STALE (not left pending), audited
    expect(await inT(t, () => repo.getChangeRequest(t, r2.body.id))).toMatchObject({ status: "rejected", decisionReason: expect.stringMatching(/^STALE/) });
    expect(((await call("GET", `${P}/settings/change-requests?status=pending`, admin(t))).body.data as { id: string }[]).map((r) => r.id)).not.toContain(r2.body.id);
    expect(await auditsOf(t, "profile_change_stale_rejected")).toHaveLength(1);
  });

  it("delete: an UNREFERENCED profile is deleted directly (audited); one a batch still references needs a super_admin second approver", async () => {
    const t = newTenant();
    await call("POST", `${P}/profiles`, admin(t), { name: "Free", config: { dpi: 300 } });
    const free = (await profilesOf(t))[0]?.id as string;
    const d1 = await call("DELETE", `${P}/profiles/${free}`, admin(t));
    expect(d1.body.requiresApproval).toBe(false);
    expect(await profilesOf(t)).toEqual([]);
    expect(await auditsOf(t, "profile_delete")).toHaveLength(1);

    await call("POST", `${P}/profiles`, admin(t), { name: "Used", config: { dpi: 300 } });
    const used = (await profilesOf(t))[0]?.id as string;
    await insertBatchRow(t, { profileId: used });
    const d2 = await call("DELETE", `${P}/profiles/${used}`, admin(t));
    expect(d2.body.requiresApproval).toBe(true);
    expect(await profilesOf(t)).toHaveLength(1);                                             // still there
    await send(q, COMMANDS.bulkProfileDelete, t, USER1, { profileId: used });                                // direct publish: queued as a request, not applied
    expect(await profilesOf(t)).toHaveLength(1);
    expect((await call("POST", `${P}/settings/change-requests/${d2.body.id}/approve`, admin(t, USER2), {})).body.code).toBe("SUPER_ADMIN_REQUIRED");
    expect((await call("POST", `${P}/settings/change-requests/${d2.body.id}/approve`, superAdmin(t), {})).status).toBe(202);
    expect(await profilesOf(t)).toEqual([]);
  });

  it("settings approval does not supersede a pending profile request", async () => {
    const t = newTenant();
    const pid = (await call("POST", `${P}/profiles`, admin(t), { name: "p", config: { reviewThreshold: 0.1 } })).body.id as string;
    const sid = (await call("PUT", `${P}/settings`, admin(t), { settings: { dpi: 400 } })).body.id as string;
    expect((await call("POST", `${P}/settings/change-requests/${sid}/approve`, admin(t, USER2), {})).status).toBe(202);
    expect(((await call("GET", `${P}/settings/change-requests?status=pending`, admin(t))).body.data as { id: string }[]).map((r) => r.id)).toEqual([pid]);
    expect((await call("POST", `${P}/settings/change-requests/${pid}/approve`, superAdmin(t), {})).status).toBe(202);
    expect(await profilesOf(t)).toHaveLength(1);
  });
});

describe("concurrency", () => {
  it("two super_admins approving the same loosening request at once: exactly one winner, one effect", async () => {
    const t = newTenant();
    const reqId = randomUUID(), profileId = randomUUID();
    await send(q, COMMANDS.bulkProfileChangePropose, t, USER1, { requestId: reqId, profileId, change: { op: "create", name: "Race", config: { reviewThreshold: 0.1 } } }, reqId);
    const res = await Promise.allSettled([USER2, USER3].map((u) => send(q, COMMANDS.bulkSettingsApprove, t, u, { requestId: reqId, actorRoles: ["super_admin"] })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/NOT_PENDING/);
    expect(await inT(t, () => repo.listProfiles(t))).toHaveLength(1);
  });

  it("tenant settings: two concurrent loosening approvals, one winner; a concurrent tightening and approval stay consistent", async () => {
    const t = newTenant();
    const id = randomUUID();
    await send(q, COMMANDS.bulkSettingsPropose, t, USER1, { requestId: id, settings: { ...DEFAULT_SETTINGS, reviewThreshold: 0.2 } }, id);
    const res = await Promise.allSettled([USER2, USER3].map((u) => send(q, COMMANDS.bulkSettingsApprove, t, u, { requestId: id, actorRoles: ["super_admin"] })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const eff = await inT(t, () => repo.resolveEffectiveSettings(t));
    expect(eff).toMatchObject({ version: 1, settings: { reviewThreshold: 0.2 } });
  });

  it("a stale loosening approval after an immediate tightening is refused (superseded)", async () => {
    const t = newTenant();
    const id = randomUUID(), id2 = randomUUID();
    await send(q, COMMANDS.bulkSettingsPropose, t, USER1, { requestId: id, settings: { ...DEFAULT_SETTINGS, reviewThreshold: 0.2 } }, id);
    await send(q, COMMANDS.bulkSettingsPropose, t, USER1, { requestId: id2, settings: { ...DEFAULT_SETTINGS, malwareFailClosed: true, filingMakerChecker: true, reviewThreshold: 0.95 } }, id2);
    await expect(send(q, COMMANDS.bulkSettingsApprove, t, USER2, { requestId: id, actorRoles: ["super_admin"] })).rejects.toThrow(/NOT_PENDING/);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.reviewThreshold).toBe(0.95);
  });

  it("proposing: invalid profile input and missing profile are rejected", async () => {
    const t = newTenant();
    await expect(send(q, COMMANDS.bulkProfileChangePropose, t, USER1, { requestId: randomUUID(), profileId: randomUUID(), change: { op: "create", name: "n", config: { malwareFailClosed: false } } })).rejects.toThrow(/INVALID_PROFILE/);
    await expect(send(q, COMMANDS.bulkProfileChangePropose, t, USER1, { requestId: randomUUID(), profileId: randomUUID(), change: { op: "delete" } })).rejects.toThrow(/PROFILE_NOT_FOUND/);
  });
});

describe("approver identity", () => {
  it("a forged checkerIsSuperAdmin payload flag does not let a non-super_admin approve a sensitive change", async () => {
    const t = newTenant();
    const id = randomUUID();
    await send(q, COMMANDS.bulkSettingsPropose, t, USER1, { requestId: id, settings: { ...DEFAULT_SETTINGS, reviewThreshold: 0.1 } }, id);
    await expect(send(q, COMMANDS.bulkSettingsApprove, t, USER2, { requestId: id, checkerIsSuperAdmin: true })).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    await expect(send(q, COMMANDS.bulkSettingsApprove, t, USER2, { requestId: id, checkerIsSuperAdmin: true, actorRoles: ["document_admin"] })).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.reviewThreshold).toBe(0.8);
    await send(q, COMMANDS.bulkSettingsApprove, t, USER2, { requestId: id, actorRoles: ["super_admin"] });
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.reviewThreshold).toBe(0.1);
  });
  it("over HTTP the stamped roles come from the verified JWT (a document_admin is refused, a super_admin approves)", async () => {
    const t = newTenant();
    const id = (await call("PUT", `${P}/settings`, admin(t), { settings: { duplicatePolicy: "keep" } })).body.id as string;
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, admin(t, USER2), { checkerIsSuperAdmin: true })).status).toBe(400);   // strict body: unknown field refused
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, admin(t, USER2), {})).body.code).toBe("SUPER_ADMIN_REQUIRED");
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, superAdmin(t), {})).status).toBe(202);
    expect((await settingsOf(t)).settings.duplicatePolicy).toBe("keep");
  });
});

describe("stale approvals are rejected (STALE), not left pending", () => {
  it("settings: base version moved on -> the approval fails, the request is rejected/STALE and audited, gone from the pending list; a redelivery is a no-op", async () => {
    const t = newTenant();
    const id = (await call("PUT", `${P}/settings`, admin(t), { settings: { dpi: 400 } })).body.id as string;      // base version 0
    await putSettings(t, { dpi: 350 }, 1);                                                                      // settings moved on WITHOUT superseding the request
    const msgId = randomUUID();
    await expect(send(q, COMMANDS.bulkSettingsApprove, t, USER2, { requestId: id, actorRoles: ["document_admin"] }, msgId)).rejects.toThrow(/STALE_BASE/);
    expect(await inT(t, () => repo.getChangeRequest(t, id))).toMatchObject({ status: "rejected", decisionReason: "STALE", checker: USER2 });
    expect((await call("GET", `${P}/settings/change-requests?status=pending`, admin(t))).body.data).toEqual([]);
    expect(((await call("GET", `${P}/settings/change-requests?status=rejected`, admin(t))).body.data as { id: string }[]).map((r) => r.id)).toEqual([id]);
    const audits = await auditsOf(t, "settings_change_stale_rejected");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({ details: { requestId: id, reason: "STALE", code: "STALE_BASE" } });
    expect((await settingsOf(t)).settings.dpi).toBe(350);                                                        // nothing applied
    // redelivery (same message id) is idempotent; a later approval attempt sees NOT_PENDING
    await send(q, COMMANDS.bulkSettingsApprove, t, USER2, { requestId: id, actorRoles: ["document_admin"] }, msgId);
    expect(await auditsOf(t, "settings_change_stale_rejected")).toHaveLength(1);
    await expect(send(q, COMMANDS.bulkSettingsApprove, t, USER3, { requestId: id, actorRoles: ["document_admin"] })).rejects.toThrow(/NOT_PENDING/);
  });

  it("a normal approval is unaffected; concurrent approvals of a current request: one winner, no STALE rejection", async () => {
    const t = newTenant();
    const ok = (await call("PUT", `${P}/settings`, admin(t), { settings: { dpi: 400 } })).body.id as string;
    expect((await call("POST", `${P}/settings/change-requests/${ok}/approve`, admin(t, USER2), {})).status).toBe(202);
    expect(await inT(t, () => repo.getChangeRequest(t, ok))).toMatchObject({ status: "approved" });
    const id = randomUUID();
    await send(q, COMMANDS.bulkSettingsPropose, t, USER1, { requestId: id, settings: { ...DEFAULT_SETTINGS, dpi: 500 } }, id);
    const res = await Promise.allSettled([USER2, USER3].map((u) => send(q, COMMANDS.bulkSettingsApprove, t, u, { requestId: id, actorRoles: ["document_admin"] })));
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);     // the winner applies (base still current)
    expect(await auditsOf(t, "settings_change_stale_rejected")).toHaveLength(0);
  });
});
