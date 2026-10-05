import { describe, expect, it } from "vitest";
import {
  FIXTURE_IDS, LINK_REASON_CODES, LINK_RESULT_STATUSES, LINK_TARGETS, LINK_TOPICS, SCAN_DOC_TYPES, TARGET_SERVICE,
  amountMinorSchema, financeMatchHintSchema, linkReasonCodeSchema, linkRequestFixture, linkRequestSchema, linkResultFixture,
  linkResultSchema, linkedDocumentMetaSchema, lookupCandidateSchema, lookupResponseSchema, scanLinkFixtures, targetIdSchema,
  unlinkRequestFixture, unlinkRequestSchema, unlinkResultFixture, unlinkResultSchema,
} from "../src/index.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("fixtures round-trip through the schemas for every target and status", () => {
  const all = scanLinkFixtures();
  for (const target of LINK_TARGETS) {
    it(`${target}: request, results and unlink messages parse back identically`, () => {
      const f = all[target];
      expect(linkRequestSchema.parse(f.request)).toEqual(f.request);
      expect(unlinkRequestSchema.parse(f.unlinkRequest)).toEqual(f.unlinkRequest);
      for (const status of LINK_RESULT_STATUSES) {
        expect(linkResultSchema.parse(f.results[status])).toEqual(f.results[status]);
        expect(f.results[status].target).toBe(target);
      }
      for (const status of ["unlinked", "rejected"] as const) expect(unlinkResultSchema.parse(f.unlinkResults[status])).toEqual(f.unlinkResults[status]);
      // JSON (the real wire format) round trip
      expect(linkRequestSchema.parse(JSON.parse(JSON.stringify(f.request)))).toEqual(f.request);
    });
  }

  it("finance fixtures carry a financeHint, the others do not", () => {
    for (const t of LINK_TARGETS) expect(Boolean(all[t].request.financeHint)).toBe(TARGET_SERVICE[t] === "finance");
  });

  it("status/reason pairing of the fixtures: linked=null, rejected=code, flagged=AMOUNT_MISMATCH", () => {
    expect(linkResultFixture("hr_employee", "linked").reason).toBeNull();
    expect(linkResultFixture("hr_employee", "rejected").reason).toBe("TARGET_NOT_FOUND");
    expect(linkResultFixture("finance_bill", "flagged_mismatch").reason).toBe("AMOUNT_MISMATCH");
    expect(unlinkResultFixture("unlinked").reason).toBeNull();
    expect(unlinkResultFixture("rejected").reason).toBe("LINK_NOT_FOUND");
  });

  it("topic names follow <svc>.scan-link.*", () => {
    for (const t of LINK_TARGETS) {
      const svc = TARGET_SERVICE[t];
      expect(LINK_TOPICS.request(svc)).toBe(`${svc}.scan-link.request`);
      expect(LINK_TOPICS.unlinkResult(svc)).toBe(`${svc}.scan-link.unlink.result`);
    }
  });
});

describe(".strict(): unknown keys are rejected, not stripped", () => {
  const req = linkRequestFixture("finance_voucher");
  const res = linkResultFixture("hr_employee", "linked");
  const unreq = unlinkRequestFixture("eoffice_file");
  const unres = unlinkResultFixture("unlinked");
  const cand = { target: "hr_employee", targetId: UUID, label: "E-1", amountMinor: null, reference: null, confidence: 1 };

  it.each([
    ["linkRequest", () => linkRequestSchema.safeParse({ ...req, tenantId: UUID })],
    ["linkRequest.document", () => linkRequestSchema.safeParse({ ...req, document: { ...req.document, extractedText: "x" } })],
    ["linkRequest.financeHint", () => linkRequestSchema.safeParse({ ...req, financeHint: { reference: "R", amountMinor: "1", extra: 1 } })],
    ["linkResult", () => linkResultSchema.safeParse({ ...res, note: "x" })],
    ["unlinkRequest", () => unlinkRequestSchema.safeParse({ ...unreq, force: true })],
    ["unlinkResult", () => unlinkResultSchema.safeParse({ ...unres, target: "hr_employee" })],
    ["lookupCandidate", () => lookupCandidateSchema.safeParse({ ...cand, pii: "x" })],
    ["lookupResponse", () => lookupResponseSchema.safeParse({ data: [cand], total: 1 })],
    ["financeMatchHint", () => financeMatchHintSchema.safeParse({ reference: null, amountMinor: null, x: 1 })],
    ["linkedDocumentMeta", () => linkedDocumentMetaSchema.safeParse({ ...req.document, x: 1 })],
  ])("%s", (_n, run) => {
    const r = run();
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("the same messages without the extra key are accepted", () => {
    expect(linkRequestSchema.safeParse(req).success).toBe(true);
    expect(lookupResponseSchema.safeParse({ data: [cand] }).success).toBe(true);
  });
});

describe("field validation", () => {
  it("amountMinor is a 1-18 digit string everywhere it appears", () => {
    for (const ok of ["0", "150000", "123456789012345678"]) {
      expect(amountMinorSchema.safeParse(ok).success).toBe(true);
      expect(lookupCandidateSchema.safeParse({ target: "finance_bill", targetId: UUID, label: "B", amountMinor: ok, reference: "R", confidence: 0.5, requestedAmountMinor: ok }).success).toBe(true);
    }
    for (const bad of ["", "-1", "1.5", "1e3", "12 3", "1234567890123456789", " 5", "5\n"]) {
      expect(amountMinorSchema.safeParse(bad).success).toBe(false);
      expect(lookupCandidateSchema.safeParse({ target: "finance_bill", targetId: UUID, label: "B", amountMinor: bad, reference: null, confidence: 0.5 }).success).toBe(false);
      expect(lookupCandidateSchema.safeParse({ target: "finance_bill", targetId: UUID, label: "B", amountMinor: null, reference: null, confidence: 0.5, requestedAmountMinor: bad }).success).toBe(false);
      expect(financeMatchHintSchema.safeParse({ reference: null, amountMinor: bad }).success).toBe(false);
    }
    expect(lookupCandidateSchema.safeParse({ target: "hr_employee", targetId: UUID, label: "E", amountMinor: null, reference: null, confidence: 1, requestedAmountMinor: null, amountMatches: null }).success).toBe(true);
  });

  it("targetId is length-bounded on every message (empty and >128 rejected) but deliberately permissive in charset", () => {
    for (const id of ["EST/2026/1", "EMP-0042", UUID, "x".repeat(128)]) expect(targetIdSchema.safeParse(id).success).toBe(true);
    for (const bad of ["", "x".repeat(129)]) {
      expect(targetIdSchema.safeParse(bad).success).toBe(false);
      expect(linkRequestSchema.safeParse({ ...linkRequestFixture("hr_employee"), targetId: bad }).success).toBe(false);
      expect(linkResultSchema.safeParse({ ...linkResultFixture("hr_employee", "linked"), targetId: bad }).success).toBe(false);
      expect(unlinkRequestSchema.safeParse({ ...unlinkRequestFixture("hr_employee"), targetId: bad }).success).toBe(false);
    }
  });

  it("ids must be uuids where they are uuids", () => {
    expect(linkRequestSchema.safeParse({ ...linkRequestFixture("hr_employee"), linkId: "nope" }).success).toBe(false);
    expect(linkRequestSchema.safeParse({ ...linkRequestFixture("hr_employee"), requestedBy: "nope" }).success).toBe(false);
    expect(linkResultSchema.safeParse({ ...linkResultFixture("hr_employee", "linked"), documentId: "nope" }).success).toBe(false);
    expect(unlinkResultSchema.safeParse({ ...unlinkResultFixture("unlinked"), linkId: "nope" }).success).toBe(false);
  });

  it("unknown target kinds, statuses and doc fields are rejected", () => {
    expect(linkRequestSchema.safeParse({ ...linkRequestFixture("hr_employee"), target: "hr_payslip" }).success).toBe(false);
    expect(linkResultSchema.safeParse({ ...linkResultFixture("hr_employee", "linked"), status: "pending" }).success).toBe(false);
    expect(linkRequestSchema.safeParse({ ...linkRequestFixture("hr_employee"), document: { ...linkRequestFixture("hr_employee").document, ocrConfidence: 1.5 } }).success).toBe(false);
    expect(linkRequestSchema.safeParse({ ...linkRequestFixture("hr_employee"), document: { ...linkRequestFixture("hr_employee").document, filedAt: "yesterday" } }).success).toBe(false);
  });

  it("unlink reason: min 5, max 500; a whitespace-padded short reason still passes the schema (consumers answer REASON_REQUIRED)", () => {
    const base = unlinkRequestFixture("hr_employee");
    expect(unlinkRequestSchema.safeParse({ ...base, reason: "abcd" }).success).toBe(false);
    expect(unlinkRequestSchema.safeParse({ ...base, reason: "abcde" }).success).toBe(true);
    expect(unlinkRequestSchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(false);
    const padded = unlinkRequestSchema.safeParse({ ...base, reason: "  ab  " });
    expect(padded.success).toBe(true);
    if (padded.success) expect(padded.data.reason).toBe("  ab  "); // unmodified: the consumer trims and answers REASON_REQUIRED
  });

  it("result detail: PII-free scalars only, max 8 keys", () => {
    const base = linkResultFixture("finance_bill", "flagged_mismatch");
    expect(linkResultSchema.safeParse({ ...base, detail: { expectedMinor: "100", scannedMinor: "90", n: 1, ok: false } }).success).toBe(true);
    expect(linkResultSchema.safeParse({ ...base, detail: { a: { nested: 1 } } }).success).toBe(false);
    expect(linkResultSchema.safeParse({ ...base, detail: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])) }).success).toBe(false);
  });

  it("lookup response is capped at 20 candidates and confidence is 0..1", () => {
    const c = { target: "hr_employee", targetId: UUID, label: "E", amountMinor: null, reference: null, confidence: 1 };
    expect(lookupResponseSchema.safeParse({ data: Array.from({ length: 20 }, () => c) }).success).toBe(true);
    expect(lookupResponseSchema.safeParse({ data: Array.from({ length: 21 }, () => c) }).success).toBe(false);
    expect(lookupCandidateSchema.safeParse({ ...c, confidence: 1.01 }).success).toBe(false);
    expect(lookupCandidateSchema.safeParse({ ...c, label: "x".repeat(301) }).success).toBe(false);
  });
});

describe("reason-code vocabulary", () => {
  it("is the documented closed set (changing it is a contract change)", () => {
    expect([...LINK_REASON_CODES]).toEqual([
      "TARGET_NOT_FOUND", "TARGET_KIND_MISMATCH", "TARGET_CLASSIFIED", "FILE_CLOSED", "UNSUPPORTED_TARGET", "DOCUMENT_ALREADY_LINKED",
      "LINK_ALREADY_USED", "AMOUNT_MISMATCH", "REFERENCE_MISMATCH", "MISSING_MATCH_HINT", "LINK_NOT_FOUND", "LINK_ALREADY_UNLINKED", "REASON_REQUIRED",
      "MAKER_CHECKER_VIOLATION",
    ]);
    expect(new Set(LINK_REASON_CODES).size).toBe(LINK_REASON_CODES.length);
  });
  it("every code is accepted in results and free text is not", () => {
    for (const code of LINK_REASON_CODES) {
      expect(linkReasonCodeSchema.safeParse(code).success).toBe(true);
      expect(linkResultSchema.safeParse({ ...linkResultFixture("hr_employee", "rejected"), reason: code }).success).toBe(true);
      expect(unlinkResultSchema.safeParse({ ...unlinkResultFixture("rejected"), reason: code }).success).toBe(true);
    }
    for (const bad of ["employee 2345 6789 0123 not found", "target_not_found", ""]) {
      expect(linkResultSchema.safeParse({ ...linkResultFixture("hr_employee", "rejected"), reason: bad }).success).toBe(false);
    }
  });
});

describe("constants", () => {
  it("every target maps to a service and a fixture doc type exists in the starter doc-type set", () => {
    for (const t of LINK_TARGETS) expect(["hrms", "finance", "estab"]).toContain(TARGET_SERVICE[t]);
    for (const t of LINK_TARGETS) expect(SCAN_DOC_TYPES).toContain(linkRequestFixture(t).document.docType);
    expect(FIXTURE_IDS.linkId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
