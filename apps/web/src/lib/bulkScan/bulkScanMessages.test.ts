import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { specificErrorKey } from "./api";
import { FAILURE_REASON_CODES, KNOWN_FILE_STATES, LINK_REASON_CODES, REVIEW_REASON_CODES, COUNT_GROUPS, describeReviewReason } from "./status";
import { FILE_STATES, LINK_STATES, LINK_TARGETS, BATCH_STATUSES } from "./types";
import { DUPLICATE_POLICIES, FIELD_KINDS, OCR_LANGS, OCR_PROVIDER_IDS, PII_ACTIONS, PII_TYPES, PREPROCESS_STEPS, describeIssue, settingsSchema } from "./settingsSchema";
import { SHORTCUT_HELP } from "./review";
import { FAILURE_KEYS } from "./download";
import { settingsObject } from "./fixtures";

type Tree = { [k: string]: string | Tree };
const NS = "bulkScan";
const enNs = (en as unknown as Record<string, Tree>)[NS]!;
const hiNs = (hi as unknown as Record<string, Tree>)[NS]!;

function flatten(t: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "string") out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}
const E = flatten(enNs);
const H = flatten(hiNs);
const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("bulkScan messages", () => {
  it("exist in both English and Hindi with identical keys and placeholders", () => {
    expect(Object.keys(H).sort()).toEqual(Object.keys(E).sort());
    for (const k of Object.keys(E)) expect(placeholders(H[k]!), k).toEqual(placeholders(E[k]!));
    for (const [k, v] of Object.entries(H)) expect(v.trim().length, k).toBeGreaterThan(0);
  });

  it("every literal t(\"...\") key used by the Bulk scan UI exists in en and hi", () => {
    const roots = [join(__dirname), join(__dirname, "../../app/(app)/admin/bulk-scan")];
    const used = new Set<string>();
    for (const f of roots.flatMap(sourceFiles)) {
      for (const m of readFileSync(f, "utf8").matchAll(/\bt\("([A-Za-z0-9_.]+)"/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(300);
    const missing = [...used].filter((k) => !(k in E) || !(k in H));
    expect(missing).toEqual([]);
  });

  it("every key built from a constant (dynamic t(`...`)) exists too", () => {
    const keys: string[] = [];
    FILE_STATES.forEach((s) => keys.push(`state.${s}`));
    KNOWN_FILE_STATES.forEach((s) => keys.push(`state.${s}`));
    BATCH_STATUSES.forEach((s) => keys.push(`batchStatus.${s}`));
    LINK_STATES.forEach((s) => keys.push(`linkState.${s}`));
    COUNT_GROUPS.forEach((g) => keys.push(`group.${g.id}`));
    LINK_TARGETS.forEach((x) => keys.push(`target.${x}`));
    FIELD_KINDS.forEach((x) => keys.push(`field.${x}`));
    PII_TYPES.forEach((x) => keys.push(`pii.${x}`));
    PII_ACTIONS.forEach((x) => keys.push(`piiAction.${x}`));
    DUPLICATE_POLICIES.forEach((x) => keys.push(`duplicate.${x}`));
    OCR_LANGS.forEach((x) => keys.push(`lang.${x}`));
    PREPROCESS_STEPS.forEach((x) => keys.push(`step.${x}`));
    OCR_PROVIDER_IDS.forEach((x) => keys.push(`provider.${x}`));
    FAILURE_REASON_CODES.forEach((x) => keys.push(`reason.${x}`));
    ["quarantined", "scan_pending", "skipped_duplicate", "unknown"].forEach((x) => keys.push(`reason.${x}`));
    ["high", "medium", "low", "unknown"].forEach((x) => keys.push(`confidence.${x}`));
    ["invalid", "pending", "ready", "uploading", "uploaded", "completed", "failed", "on_server"].forEach((x) => keys.push(`upload.status.${x}`));
    ["EMPTY_FILE", "EXECUTABLE_CONTENT", "SVG_NOT_ALLOWED", "UNSUPPORTED_FILE_TYPE", "ENCRYPTED_PDF", "FILE_TOO_LARGE", "TOO_MANY_FILES", "BATCH_TOO_LARGE", "UNREADABLE"].forEach((x) => keys.push(`new.reject.${x}`));
    ["nameRequired", "nameTooLong", "tagsInvalid", "docTypeUnknown", "folderInvalid", "targetInvalid", "targetNotAllowed", "targetMissing", "targetIdTooLong", "profileInvalid"].forEach((x) => keys.push(`new.err.${x}`));
    ["languages", "dpi", "preprocessingSteps", "reviewThreshold", "bestOf", "providerChain", "defaultDocType", "linkDefaults", "classification"].forEach((x) => keys.push(`profiles.key.${x}`));
    SHORTCUT_HELP.forEach((s) => keys.push(`review.shortcut.${s.labelKey}`));
    Object.values(FAILURE_KEYS).forEach((k) => keys.push(k));
    keys.push("link.lookupUnavailable", "link.lookupNotConfigured");
    [...REVIEW_REASON_CODES, "MISSING_FIELD:x", "DEGRADED:x", "garbage"].forEach((c) => keys.push(describeReviewReason(c).key));
    [...LINK_REASON_CODES, "WHATEVER"].forEach((c) => keys.push(describeReviewReason(`LINK_${c}`).key));
    for (const r of [
      { status: 409, code: "STALE" }, { status: 403, code: null }, { status: 401, code: null }, { status: 0, code: null }, { status: 500, code: null }, { status: 404, code: null }, { status: 400, code: "x" },
      ...["MAKER_CHECKER_VIOLATION", "SUPER_ADMIN_REQUIRED", "REASON_REQUIRED", "NOT_PENDING", "NOT_RETRYABLE", "NOT_SKIPPABLE", "BATCH_CANCELLED", "ALREADY_CANCELLED", "VALIDATION_FAILED", "FILE_TOO_LARGE", "TOO_MANY_FILES", "BATCH_TOO_LARGE", "LINK_TARGET_NOT_ALLOWED", "UNKNOWN_PROFILE", "UNKNOWN_DOC_TYPE", "NOT_FOUND", "STORAGE_UNAVAILABLE", "CLEARANCE_DENIED", "CLEARANCE_UNAVAILABLE", "NOT_REVIEWABLE", "LINK_ALREADY_ACTIVE", "NOT_LINKED", "INVALID_LINK_TARGET", "INVALID_FIELD_VALUE", "VARIANT_UNAVAILABLE", "NOT_PENDING_UPLOAD"].map((code) => ({ status: 409, code })),
    ]) { const k = specificErrorKey({ ok: false, status: r.status, code: r.code, message: null, reference: null }); if (k) keys.push(k); }
    // every settings validation issue key the schema can produce
    const bad = settingsSchema.safeParse({ ...settingsObject(), dpi: 1, languages: [], twoDigitYearPivot: 500, bestOf: { enabled: true, threshold: 2 }, retentionDaysByType: { ghost: 1 },
      providerChain: [{ id: "tesseract", timeoutMs: 1 }, { id: "tesseract", timeoutMs: 1 }], preprocessingSteps: ["rotate", "rotate"], allowedLinkTargets: ["hr_employee", "hr_employee"],
      classification: { docTypes: [{ id: "Bad id", label: "", keywords: [], requiredFields: ["date", "date"] }, { id: "Bad id", label: "x", keywords: [], requiredFields: [] }], uncertainBelow: 3 } });
    if (!bad.success) bad.error.issues.forEach((i) => keys.push(`settings.${describeIssue(i).key}`));
    ["err.dupLanguage", "err.dupStep", "err.dupTarget", "err.dupDocType", "err.otherRequired", "err.dupRequiredField", "err.retentionUnknownType", "err.reasonRequired", "err.invalid", "err.required", "err.min", "err.max", "err.minItems", "err.maxItems", "err.maxLength", "err.docTypeId", "err.bestOfNeedsTwo", "err.indicDpi", "err.dupProvider"].forEach((x) => keys.push(`settings.${x}`));
    const missing = [...new Set(keys)].filter((k) => !(k in E) || !(k in H));
    expect(missing).toEqual([]);
  });
});
