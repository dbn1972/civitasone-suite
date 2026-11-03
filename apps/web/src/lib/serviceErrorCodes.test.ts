import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CODE_FAMILIES, SERVICE_CODE_MESSAGES, codeFamily, resolveServiceCode, type ServiceCodeMessage } from "./serviceErrorCodes";
import { DOMAIN_CODE_MESSAGES, ERROR_CATALOGUE, resolveHumanError } from "./errorCatalogue";

/**
 * GAP-UAT-P3-ERRCOPY (review of #2451): every error code the services can return gets
 * copy that names the right cause, or the honest status copy. A naming family may only
 * refine a 4xx, and only when the name is unambiguous; 5xx / 408 / 429 / 401 keep the
 * status copy unless a hand-written entry is marked serverSide.
 */
const SERVICES = resolve(__dirname, "../../../../services");
const LITERAL_PATTERNS = [
  /Error\(\s*\d{3},\s*"([A-Z][A-Z0-9_]{2,})"/g, // new HttpError(409, "CODE", ...)
  /DomainError\(\s*"([A-Z][A-Z0-9_]{2,})"/g, // new DomainError("CODE", ...)
  /send\(\{\s*code:\s*"([A-Z][A-Z0-9_]{2,})"/g, // reply.send({ code: "CODE", ... })
  /code:\s*"([A-Z][A-Z0-9_]{2,})",\s*message/g, // { code: "CODE", message: ... }
  /Error\(\s*`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):/g, // new Error('CODE: ...')
];
// Codes thrown through a constant: HttpError(409, ZERO_BASIC_SLIPS, ...), CODES.X, NonRetryableError('${CODE}: ...').
const IDENTIFIER_PATTERNS = [
  /Error\(\s*\d{3},\s*(?:[A-Za-z_]\w*\.)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*,/g,
  /DomainError\(\s*(?:[A-Za-z_]\w*\.)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*,/g,
  /Error\(\s*`\$\{(?:[A-Za-z_]\w*\.)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\}/g,
];
// export const X = "X"; enum members X = "X"; object entries X: "X".
const CONSTANT_DEFINITION = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*(?::\s*[\w<>|" ]+)?\s*[=:]\s*"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g;

function walk(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const name = ent.name;
    if (name === "node_modules" || name === "dist" || name === "tests" || name === "__tests__" || name === "migrations") continue;
    const p = join(dir, name);
    // Symlinks are skipped (a dangling seed link must not break the scan).
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && name.endsWith(".ts") && !name.includes(".test.") && !name.endsWith(".d.ts")) out.push(p);
  }
}

function harvestServiceCodes(): { codes: Set<string>; viaConstant: Set<string>; at409: Set<string> } {
  const files: string[] = [];
  walk(SERVICES, files);
  const codes = new Set<string>();
  const constants = new Map<string, string>();
  const identifiers = new Set<string>();
  const at409 = new Set<string>();
  const ids409 = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of LITERAL_PATTERNS) for (const m of src.matchAll(re)) if (m[1].includes("_")) codes.add(m[1]);
    for (const re of IDENTIFIER_PATTERNS) for (const m of src.matchAll(re)) identifiers.add(m[1]);
    for (const m of src.matchAll(CONSTANT_DEFINITION)) if (!constants.has(m[1])) constants.set(m[1], m[2]);
    for (const m of src.matchAll(/Error\(\s*409,\s*"([A-Z][A-Z0-9_]{2,})"/g)) at409.add(m[1]);
    for (const m of src.matchAll(/Error\(\s*409,\s*(?:[A-Za-z_]\w*\.)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*,/g)) ids409.add(m[1]);
  }
  const viaConstant = new Set<string>();
  for (const id of identifiers) {
    const v = constants.get(id);
    if (v) {
      viaConstant.add(v);
      codes.add(v);
    }
  }
  for (const id of ids409) {
    const v = constants.get(id);
    if (v) at409.add(v);
  }
  return { codes, viaConstant, at409 };
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const DEVANAGARI = /[ऀ-ॿ]/;
const NEUTRAL_409_EN = "This action can't be done on this record right now. It may have changed, or be in a state that doesn't allow it. Refresh to see its current status.";
const NEUTRAL_409_HI = "यह कार्रवाई अभी इस रिकॉर्ड पर नहीं की जा सकती। हो सकता है इसमें बदलाव हुआ हो, या यह ऐसी स्थिति में हो जिसमें यह कार्रवाई संभव नहीं है। इसकी वर्तमान स्थिति देखने के लिए पेज रीफ़्रेश करें।";
const handMapped = (c: string) => Object.prototype.hasOwnProperty.call(DOMAIN_CODE_MESSAGES, c) || Object.prototype.hasOwnProperty.call(SERVICE_CODE_MESSAGES, c);

describe("service error codes: harvest and coverage", () => {
  const { codes, viaConstant, at409 } = harvestServiceCodes();

  it("finds literal codes and codes thrown through constants", () => {
    expect(codes.size).toBeGreaterThan(800);
    for (const c of ["MAKER_CHECKER_VIOLATION", "TASK_NOT_AUTHORIZED", "SANCTION_REF_REQUIRED", "BUDGET_EXCEEDED", "NO_EMPLOYEE_RECORD"]) expect(codes.has(c), c).toBe(true);
    for (const c of ["ASSET_GL_NOT_CONFIGURED", "WORKFLOW_NOT_CONFIGURED"]) expect(viaConstant.has(c) || codes.has(c), c).toBe(true);
  });

  it("reports coverage as hand-mapped, pattern-matched and status fallback (no assertion on the split: unmapped is allowed)", () => {
    let hand = 0;
    let pattern = 0;
    let fallback = 0;
    for (const c of codes) {
      if (handMapped(c)) hand++;
      else if (codeFamily(c)) pattern++;
      else fallback++;
    }
    // eslint-disable-next-line no-console -- coverage report for the PR
    console.log("[service codes] total=" + codes.size + " handMapped=" + hand + " patternMatched=" + pattern + " statusFallback=" + fallback + " viaConstant=" + viaConstant.size);
    expect(hand + pattern + fallback).toBe(codes.size);
  });

  it("no harvested code, at any status, shows the code, a placeholder or blames the connection", () => {
    for (const code of codes) {
      for (const status of [400, 403, 404, 409, 422, 500, 503]) {
        for (const locale of ["en", "hi"] as const) {
          const r = resolveHumanError({ status, code, ctx: { locale, intent: "save" } });
          const text = r.what + " " + r.next;
          expect(text, code).not.toContain(code);
          expect(text, code).not.toMatch(/internet|इंटरनेट/i);
          expect(text, code).not.toMatch(/\{\w+\}/);
        }
      }
    }
  });

  // Named, keyed check (not a count): a code thrown with 409 that has no entry and no family gets the
  // neutral 409 copy, never the concurrency claim "changed by someone else".
  it("every code thrown with 409 that has no entry and no family reads as the neutral 409 copy", () => {
    expect(at409.size).toBeGreaterThan(100);
    for (const code of at409) {
      if (handMapped(code) || codeFamily(code)) continue;
      const e = resolveHumanError({ status: 409, code, ctx: { locale: "en" } });
      expect(e.what + " " + e.next, code).toBe(NEUTRAL_409_EN);
      const h = resolveHumanError({ status: 409, code, ctx: { locale: "hi" } });
      expect(h.what + " " + h.next, code).toBe(NEUTRAL_409_HI);
    }
  });

  it("only genuine version / ETag / STALE / CONCURRENT codes say \"changed by someone else\"", () => {
    for (const code of codes) {
      const e = resolveHumanError({ status: 409, code, ctx: { locale: "en" } });
      if (/changed by someone else/.test(e.what)) {
        expect(DOMAIN_CODE_MESSAGES[code] !== undefined || codeFamily(code)?.id === "versionConflict", code).toBe(true);
      }
    }
  });

  it("a 5xx, 429, 408, 504 or 401 with ANY code gets the status copy, or a dedicated serverSide message", () => {
    const en = ERROR_CATALOGUE.en.kinds;
    for (const code of [...codes, "INVALID_STATE", "NOT_PENDING", "BUDGET_EXCEEDED", "MAKER_CHECKER_VIOLATION", "SELF_APPROVAL", "DUPLICATE_PAN"]) {
      const serverSide = SERVICE_CODE_MESSAGES[code]?.serverSide === true || DOMAIN_CODE_MESSAGES[code]?.serverSide === true;
      for (const status of [500, 502, 503]) {
        const r = resolveHumanError({ status, code, ctx: { locale: "en", intent: "save", area: "bill" } });
        if (serverSide) expect(["serviceCode", "domain"], code).toContain(r.source);
        else expect(r.what, code + "@" + status).toBe("We couldn" + String.fromCharCode(39) + "t save the bill because of a problem on our side.");
      }
      const rl = resolveHumanError({ status: 429, code, ctx: { locale: "en" } });
      if (!serverSide) expect(rl.what, code + "@429").toBe(en.rateLimited.what);
      else expect(["serviceCode", "domain"]).toContain(rl.source);
      for (const status of [408, 504]) {
        const t = resolveHumanError({ status, code, ctx: { locale: "en", intent: "load", area: "bill" } });
        if (!serverSide) expect(t.kind, code + "@" + status).toBe("timeout");
      }
      const u = resolveHumanError({ status: 401, code, ctx: { locale: "en" } });
      if (!serverSide && !SERVICE_CODE_MESSAGES[code]?.alsoAt401) expect(u.kind, code + "@401").toBe("unauthenticated");
    }
  });
});

describe("service error codes: en/hi parity of the copy", () => {
  const all: Array<[string, ServiceCodeMessage]> = [
    ...Object.entries(SERVICE_CODE_MESSAGES),
    ...CODE_FAMILIES.filter((f) => f.message).map((f) => [f.id, f.message as ServiceCodeMessage] as [string, ServiceCodeMessage]),
  ];
  it.each(all)("%s has en and hi copy, Hindi in Devanagari, matching placeholders", (_id, m) => {
    for (const part of ["what", "next"] as const) {
      expect(m.en[part].trim()).not.toBe("");
      expect(m.hi[part].trim()).not.toBe("");
      expect(m.hi[part]).not.toBe(m.en[part]);
      expect(DEVANAGARI.test(m.hi[part])).toBe(true);
      expect(placeholders(m.hi[part])).toEqual(placeholders(m.en[part]));
      expect(m.en[part]).not.toMatch(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/);
      expect(m.en[part]).toMatch(/[.!?]$/);
    }
  });
});

/**
 * Regression table: the codes the #2451 review found mis-read, with the cause category
 * each must now get. "status" means no family applies: the honest status copy is shown.
 */
type Cat =
  | "status" | "serverSide" | "explicit" | "versionConflict" | "alreadyBooked" | "notFound" | "duplicate" | "separationOfDuties"
  | "permission" | "rateLimited" | "alreadyDecided" | "stateTransition" | "linkExpired" | "documentExpired" | "windowClosed"
  | "tooLow" | "tooHigh" | "overlap" | "notConfigured" | "disabled" | "inactive" | "required" | "validation" | "upstream" | "domain"
  | "fileTooLarge" | "mismatch" | "inUse" | "alreadyDone";
const TABLE: Array<[code: string, status: number, cat: Cat]> = [
  // 5xx / 429 never turn into a user-fault message
  ["CIRCUIT_OPEN", 503, "serverSide"], ["GATEWAY_CIRCUIT_OPEN", 503, "serverSide"], ["SIGNING_SELF_CHECK_FAILED", 500, "serverSide"],
  ["RATE_LIMITED", 429, "serverSide"], ["TOO_MANY_REQUESTS", 429, "serverSide"], ["DEVICE_RATE_LIMIT", 429, "serverSide"], ["OTP_RATE_LIMITED", 429, "serverSide"],
  ["REPLAY_UNAVAILABLE", 503, "status"], ["INTERNAL", 500, "status"],
  // already decided, not "still being processed"
  ["NOT_PENDING", 409, "alreadyDecided"], ["ADJUSTMENT_NOT_PENDING", 409, "alreadyDecided"], ["REFUND_NOT_PENDING", 409, "alreadyDecided"],
  ["NOT_IN_PROGRESS", 409, "alreadyDecided"], ["NO_PENDING_CHANGE", 409, "alreadyDecided"], ["ALREADY_DECIDED", 409, "alreadyDecided"], ["ALREADY_CLOSED", 409, "alreadyDecided"],
  // conflicts: only real edit conflicts read as "changed by someone else"
  ["VERSION_CONFLICT", 409, "versionConflict"], ["STALE_REVISION", 409, "versionConflict"], ["EMPLOYEE_VERSION_CONFLICT", 409, "versionConflict"],
  ["BOOKING_CONFLICT", 409, "alreadyBooked"], ["ROOM_CONFLICT", 409, "alreadyBooked"], ["VEHICLE_CONFLICT", 409, "alreadyBooked"], ["CAUSELIST_SLOT_CONFLICT", 409, "alreadyBooked"],
  ["CONFLICT_OF_INTEREST", 403, "explicit"], ["SIGNING_CONFIG_CONFLICT", 409, "explicit"], ["FREEZE_CONFLICT", 409, "domain"], ["INSTRUMENT_NOT_STALE", 409, "status"],
  // expired: only links, codes, tokens; documents get "renew"; windows get "time has passed"
  ["OTP_EXPIRED", 400, "linkExpired"], ["TOKEN_USED", 409, "linkExpired"], ["OTP_INVALID", 400, "explicit"], ["OTP_LOCKED", 423, "explicit"],
  ["OTP_REQUIRED", 401, "explicit"], ["OTP_INVALID", 401, "explicit"], ["OTP_REQUIRED", 400, "explicit"], ["OTP_NOT_ENABLED", 400, "explicit"],
  ["CONTRACT_EXPIRED", 409, "documentExpired"], ["EMPANELMENT_EXPIRED", 409, "documentExpired"],
  ["FILING_WINDOW_EXPIRED", 409, "windowClosed"], ["CANCELLATION_WINDOW_EXPIRED", 409, "windowClosed"],
  // too low is not "reduce the amount"
  ["BID_BELOW_FLOOR", 422, "tooLow"], ["RFQ_MIN_VENDORS", 422, "tooLow"], ["EMI_TOO_LOW_TO_REPAY", 422, "tooLow"], ["NON_POSITIVE_ALLOCATION", 422, "tooLow"],
  ["JOURNAL_ZERO_AMOUNT", 422, "tooLow"], ["JOURNAL_TOO_FEW_LINES", 422, "tooLow"], ["OPENING_BALANCE_TOO_FEW_ENTRIES", 422, "tooLow"],
  ["NOTICE_PERIOD_BELOW_DEFAULT", 422, "tooLow"], ["COPIES_BELOW_OUT", 409, "tooLow"],
  ["CUSTOM_FIELD_LIMIT_REACHED", 422, "tooHigh"], ["EMI_EXCEEDS_PRINCIPAL", 422, "tooHigh"], ["COSTING_SPLIT_EXCEEDS_100", 422, "tooHigh"],
  ["INSUFFICIENT_DATA", 422, "status"], ["INSUFFICIENT_HISTORY", 422, "status"], ["INSUFFICIENT_EVIDENCE", 422, "status"], ["SMALL_COHORT", 403, "status"],
  // "not <something>" that is not a stage
  ["STATE_CODE_INVALID", 422, "explicit"], ["AADHAAR_NOT_ACCEPTED", 422, "explicit"], ["ACCOUNT_NOT_ON_FILE", 404, "explicit"], ["FEE_NOT_SET", 409, "explicit"],
  ["ACTOR_NOT_EMPLOYEE", 403, "explicit"], ["FNF_EMPLOYEE_NOT_IN_HR", 422, "explicit"], ["ATTACHMENT_NOT_UPLOADED", 409, "explicit"],
  ["MANDATORY_STAGE_FIELDS_MISSING", 422, "required"], ["CTC_PROFILE_NOT_SUPPORTED", 422, "explicit"], ["EMPTY_CONFIG_REJECTED", 422, "required"],
  ["FIELD_NOT_REVEALABLE", 403, "status"], ["NOT_AVAILABLE", 409, "status"],
  // real state codes
  ["INVALID_STATE", 409, "stateTransition"], ["INVALID_TRANSITION", 409, "stateTransition"], ["INVALID_KYC_TRANSITION", 422, "stateTransition"],
  ["CLAIM_NOT_DECIDABLE", 409, "stateTransition"], ["KYC_NOT_VERIFIED", 422, "stateTransition"], ["PO_NOT_APPROVED", 409, "stateTransition"],
  ["CASE_NOT_OPEN", 409, "stateTransition"], ["ATTENDANCE_LOCKED", 409, "stateTransition"],
  // self-* that is not separation of duties; unknown-* that is not "no longer available"
  ["SELF_DEPENDENCY", 422, "status"], ["SELF_LINK", 422, "status"], ["SELF_APPROVAL_FORBIDDEN", 403, "domain"], ["SOD_VIOLATION", 403, "separationOfDuties"],
  ["PT_GENDER_UNKNOWN", 422, "explicit"], ["PT_STATE_UNKNOWN", 422, "explicit"], ["UNKNOWN_FIELDS", 400, "status"],
  ["SUSPENDED_PAY_WITHHELD", 409, "explicit"], ["ARREARS_REVIEW_REQUIRED", 409, "explicit"], ["ZERO_BASIC_SLIPS", 409, "explicit"],
  // other families stay where they are right
  ["VENDOR_NOT_FOUND", 404, "notFound"], ["PROVIDER_EXISTS", 409, "duplicate"], ["NOT_ASSIGNEE", 403, "permission"], ["PT_SLAB_OVERLAP", 422, "overlap"],
  ["INTEGRATION_DISABLED", 409, "disabled"], ["DISABLED", 409, "disabled"], ["VENDOR_INACTIVE", 409, "inactive"], ["ASSET_GL_NOT_CONFIGURED", 409, "notConfigured"],
  ["MANDATORY_FIELDS_MISSING", 422, "required"], ["INVALID_GSTIN", 422, "validation"], ["CONFLICT", 409, "status"],
  // second pass over the family sample
  ["INSTRUMENT_STALE", 409, "explicit"], ["TEST_STALE", 409, "status"], ["BENEFICIARY_CHANGED", 409, "status"], ["ADMIT_CARD_UNAVAILABLE", 409, "status"],
  ["VARIANT_UNAVAILABLE", 404, "status"], ["HRMS_UNAVAILABLE", 409, "upstream"], ["DEVICE_REVOKED", 403, "status"], ["ALREADY_INACTIVE", 409, "alreadyDecided"],
  ["OVERRIDE_VIA_MAKER_CHECKER", 409, "status"], ["CONSENT_DENIED", 422, "status"], ["APPROVAL_REQUIRED", 422, "status"], ["SUPER_ADMIN_REQUIRED", 403, "status"],
  ["DECLARATION_WINDOW_CLOSED", 409, "windowClosed"], ["FILE_TOO_LARGE", 422, "fileTooLarge"], ["DEPT_MISMATCH", 403, "status"], ["AMOUNT_MISMATCH", 409, "mismatch"],
  ["UNSIGNED_NOT_ALLOWED_IN_PRODUCTION", 422, "explicit"],
  // delta review: 409 state, already-done and in-use rules
  ["WRONG_STATE", 409, "stateTransition"], ["NOT_ACTIVE", 409, "stateTransition"], ["LOAN_NOT_ACTIVE", 409, "stateTransition"], ["INSTANCE_NOT_ACTIVE", 409, "stateTransition"],
  ["SLIP_NOT_FINAL", 409, "stateTransition"], ["TEST_NOT_PASSED", 409, "stateTransition"], ["CANNOT_REOPEN", 409, "stateTransition"], ["REOPEN_BLOCKED", 409, "stateTransition"],
  ["CLOSE_BLOCKED", 409, "stateTransition"], ["ARCHIVE_BLOCKED", 409, "stateTransition"],
  ["IN_USE", 409, "inUse"], ["DDO_IN_USE", 409, "inUse"], ["TYPE_IN_USE", 409, "inUse"], ["STAGE_IN_USE", 409, "inUse"], ["PIPELINE_IN_USE", 409, "inUse"],
  ["HAS_ACTIVE_CHILDREN", 409, "inUse"], ["HAS_ACTIVE_POSITIONS", 409, "inUse"], ["PAY_GROUP_HAS_MEMBERS", 409, "inUse"], ["QUESTION_HAS_ANSWERS", 409, "inUse"],
  ["ALREADY_FILED", 409, "alreadyDone"], ["ALREADY_PUBLISHED", 409, "alreadyDone"], ["ALREADY_ENROLLED", 409, "alreadyDone"], ["ALREADY_ASSIGNED", 409, "alreadyDone"],
  ["ALREADY_ACTIVE", 409, "alreadyDone"], ["ALREADY_PENDING", 409, "alreadyDone"], ["ALREADY_PENDING_APPROVAL", 409, "alreadyDone"], ["REQUEST_ALREADY_OPEN", 409, "alreadyDone"],
  ["NOT_AN_EXACT_MATCH", 409, "status"], ["ROOM_AT_CAPACITY", 409, "explicit"], ["PT_BACKDATE_REASON_REQUIRED", 422, "required"],
];

function categoryOf(code: string, status: number): Cat {
  const r = resolveHumanError({ status, code, ctx: { locale: "en", intent: "save" } });
  if (r.source === "domain") return "domain";
  if (r.source === "serviceCode") return SERVICE_CODE_MESSAGES[code]?.serverSide ? "serverSide" : "explicit";
  if (r.source === "codeFamily") {
    const svc = resolveServiceCode(code, { status });
    if (svc && svc.source === "family") return svc.id as Cat;
    if (code.startsWith("DUPLICATE_")) return "duplicate";
  }
  return "status";
}

describe("service error codes: regression table from the #2451 review", () => {
  it.each(TABLE)("%s at %s reads as %s", (code, status, cat) => {
    expect(categoryOf(code, status)).toBe(cat);
  });

  it.each(["NOT_AVAILABLE", "NOT_AN_EXACT_MATCH", "INSTRUMENT_NOT_STALE", "TEST_STALE", "BENEFICIARY_CHANGED", "OVERRIDE_VIA_MAKER_CHECKER", "CONFLICT"])("%s at 409 gets the neutral 409 copy, not the concurrency claim", (code) => {
    const r = resolveHumanError({ status: 409, code, ctx: { locale: "en" } });
    expect(r.what + " " + r.next).toBe(NEUTRAL_409_EN);
  });

  it("a genuine version conflict keeps the concurrency wording", () => {
    const r = resolveHumanError({ status: 409, code: "VERSION_CONFLICT", ctx: { locale: "en" } });
    expect(r.what + " " + r.next).toBe("This record was changed by someone else. Refresh to see the latest version, then try again.");
    expect(resolveHumanError({ status: 412, ctx: { locale: "en" } }).kind).toBe("concurrentEdit");
  });

  it("an OTP refused with 401 on a public page says the code is wrong, not that a session ended", () => {
    const r = resolveHumanError({ status: 401, code: "OTP_INVALID", ctx: { locale: "en" } });
    expect(r.what).toBe("The code you entered is not correct.");
  });

  it("the not-pending family says decided or not at this step, never wait", () => {
    const r = resolveHumanError({ status: 409, code: "REFUND_NOT_PENDING", ctx: { locale: "en" } });
    expect(r.what + " " + r.next).toBe("This item has already been decided or is not at this step. Refresh to see its current status.");
  });

  it("a circuit-open 503 says the connected service is not responding", () => {
    const r = resolveHumanError({ status: 503, code: "CIRCUIT_OPEN", ctx: { locale: "en" } });
    expect(r.what).toMatch(/not responding right now/);
  });

  it("BUDGET_EXCEEDED and INSUFFICIENT_BALANCE are context-neutral", () => {
    const b = resolveHumanError({ status: 422, code: "BUDGET_EXCEEDED", ctx: { locale: "en" } });
    expect(b.what + b.next).not.toMatch(/head|re-appropriation/);
    const i = resolveHumanError({ status: 422, code: "INSUFFICIENT_BALANCE", ctx: { locale: "en" } });
    expect(i.what + i.next).not.toMatch(/account/);
  });
});

describe("service error codes: exact en and hi text for the codes named in the UAT findings", () => {
  const cases: Array<[code: string, status: number, en: string, hi: string]> = [
    ["MAKER_CHECKER_VIOLATION", 403, "This needs approval from someone other than the person who made it. Another approver needs to do this.", "इसे बनाने वाले व्यक्ति के अलावा किसी और की मंज़ूरी चाहिए। यह कार्य किसी दूसरे अनुमोदक को करना होगा।"],
    ["TASK_NOT_AUTHORIZED", 403, "This task isn't assigned to you. Only the officer it is assigned to, or a workflow administrator, can act on it. Ask your workflow administrator to reassign it if needed.", "यह कार्य आपको नहीं सौंपा गया है। इस पर केवल वही अधिकारी कार्रवाई कर सकते हैं जिन्हें यह सौंपा गया है, या वर्कफ़्लो प्रशासक। ज़रूरत हो तो वर्कफ़्लो प्रशासक से इसे दोबारा सौंपने को कहें।"],
    ["SANCTION_REF_REQUIRED", 422, "A purchase order above ₹1,000 needs an approved budget sanction. Choose the sanction reference in the Sanction field, then submit again.", "₹1,000 से अधिक के क्रय आदेश के लिए अनुमोदित बजट संस्वीकृति का संदर्भ आवश्यक है। संस्वीकृति फ़ील्ड में संस्वीकृति संदर्भ चुनें, फिर दोबारा जमा करें।"],
    ["BUDGET_EXCEEDED", 422, "This amount is more than the budget available for it. Enter a lower amount, or ask the officer who manages this budget whether it can be increased, then try again.", "यह राशि इसके लिए उपलब्ध बजट से अधिक है। कम राशि दर्ज करें, या इस बजट का प्रबंधन करने वाले अधिकारी से पूछें कि क्या इसे बढ़ाया जा सकता है, फिर प्रयास करें।"],
    ["ZERO_BASIC_SLIPS", 409, "Some payslips in this run have no basic pay, because the basic pay is missing from the employee records. Correct the basic pay in the HR records and run payroll again, or exclude each of these employees with a reason when you approve.", "इस रन की कुछ वेतन पर्चियों में मूल वेतन नहीं है, क्योंकि कर्मचारी रिकॉर्ड में मूल वेतन दर्ज नहीं है। एचआर रिकॉर्ड में मूल वेतन ठीक करके वेतन रन दोबारा चलाएँ, या अनुमोदन करते समय कारण दर्ज करके इन कर्मचारियों को बाहर रखें।"],
    ["NO_EMPLOYEE_RECORD", 403, "Your sign-in is not linked to an employee record. Ask your HR administrator to link your user account to your employee record, then sign in again.", "आपका साइन-इन किसी कर्मचारी रिकॉर्ड से जुड़ा नहीं है। अपने एचआर प्रशासक से अपना उपयोगकर्ता खाता अपने कर्मचारी रिकॉर्ड से जुड़वाएँ, फिर दोबारा साइन इन करें।"],
    ["EMPLOYEE_NO_EXISTS", 409, "An employee with this employee number already exists. Use a different employee number, or open the existing employee instead.", "इस कर्मचारी क्रमांक का कर्मचारी पहले से मौजूद है। कोई दूसरा कर्मचारी क्रमांक इस्तेमाल करें, या मौजूदा कर्मचारी को खोलें।"],
  ];
  it.each(cases)("%s at %s", (code, status, en, hi) => {
    const e = resolveHumanError({ status, code, ctx: { locale: "en" } });
    const h = resolveHumanError({ status, code, ctx: { locale: "hi" } });
    expect(e.what + " " + e.next).toBe(en);
    expect(h.what + " " + h.next).toBe(hi);
  });
});
