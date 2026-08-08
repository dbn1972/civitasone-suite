/**
 * SVC-081/082/084/089 — pure domain unit tests (no I/O).
 */
import { describe, it, expect } from "vitest";
import { assertDefinitionPublishable, mandatoryDocTypes } from "../src/modules/catalogue/domain.js";
import {
  isDigiLockerConfigured, digiLockerFetch, computeChecklist, computeLaneChecklist, verificationTransition,
} from "../src/modules/documents/domain.js";
import {
  assertWithinFilingWindow, orderOutcome, canIssueOrder, addDays, DEFAULT_FILING_WINDOW_DAYS,
} from "../src/modules/appeal/domain.js";
import { buildTrackingNumber, resolveAssistedBy, isAssistedChannel } from "../src/modules/application/intake-domain.js";

describe("SVC-081 catalogue domain", () => {
  it("accepts a well-formed publishable definition", () => {
    expect(() => assertDefinitionPublishable({ name: "X", channels: ["portal"], requiredDocuments: [{ docType: "a", mandatory: true }] })).not.toThrow();
  });
  it("rejects empty name / no channels / duplicate docType / bad channel", () => {
    expect(() => assertDefinitionPublishable({ name: "  ", channels: ["portal"], requiredDocuments: [] })).toThrow("DEF_MISSING_NAME");
    expect(() => assertDefinitionPublishable({ name: "X", channels: [], requiredDocuments: [] })).toThrow("DEF_NO_CHANNELS");
    expect(() => assertDefinitionPublishable({ name: "X", channels: ["mail" as never], requiredDocuments: [] })).toThrow("DEF_BAD_CHANNEL");
    expect(() => assertDefinitionPublishable({ name: "X", channels: ["portal"], requiredDocuments: [{ docType: "a", mandatory: true }, { docType: "a", mandatory: false }] })).toThrow("DEF_DUPLICATE_DOCUMENT");
  });
  it("mandatoryDocTypes filters to mandatory", () => {
    expect(mandatoryDocTypes([{ docType: "a", mandatory: true }, { docType: "b", mandatory: false }])).toEqual(["a"]);
  });
});

describe("SVC-084 documents domain — DigiLocker honesty gate", () => {
  it("is not configured without both creds", () => {
    expect(isDigiLockerConfigured({})).toBe(false);
    expect(isDigiLockerConfigured({ CITIZEN_DIGILOCKER_CLIENT_ID: "x" })).toBe(false);
    expect(isDigiLockerConfigured({ CITIZEN_DIGILOCKER_CLIENT_ID: "x", CITIZEN_DIGILOCKER_CLIENT_SECRET: "y" })).toBe(true);
  });
  it("unconfigured fetch is honest (no fake success)", () => {
    const r = digiLockerFetch("digilocker://x", {});
    expect(r.configured).toBe(false);
    expect(r.providerStatus).toBe("provider_unconfigured");
    expect(r.authenticity).toBe("unverified");
  });
  it("configured fetch reports source-verified", () => {
    const r = digiLockerFetch("digilocker://x", { CITIZEN_DIGILOCKER_CLIENT_ID: "a", CITIZEN_DIGILOCKER_CLIENT_SECRET: "b" });
    expect(r.configured).toBe(true);
    expect(r.authenticity).toBe("source_verified");
  });
  it("computeChecklist marks provided/verified + completeness", () => {
    const { items, complete } = computeChecklist(
      [{ docType: "a", mandatory: true }, { docType: "b", mandatory: false }],
      [{ docType: "a", status: "verified", verificationStatus: "verified" }],
    );
    expect(items.find((i) => i.docType === "a")?.verified).toBe(true);
    expect(complete).toBe(true); // only mandatory 'a' must be verified
  });
  it("FN-26 computeLaneChecklist scopes to verifiedAtLane", () => {
    const { items, laneKey } = computeLaneChecklist(
      [
        { docType: "id", mandatory: true, verifiedAtLane: "inspection" },
        { docType: "noc", mandatory: true, verifiedAtLane: "decision" },
      ],
      [],
      "lane_inspection",
    );
    expect(laneKey).toBe("inspection");
    expect(items.map((i) => i.docType)).toEqual(["id"]);
  });
  it("superseded submissions do not count as provided", () => {
    const { items } = computeChecklist([{ docType: "a", mandatory: true }], [{ docType: "a", status: "superseded", verificationStatus: "failed" }]);
    expect(items[0]!.provided).toBe(false);
  });
  it("verificationTransition maps decisions", () => {
    expect(verificationTransition("verify").verificationStatus).toBe("verified");
    expect(verificationTransition("reject").status).toBe("rejected");
    expect(verificationTransition("deficient").status).toBe("deficient");
  });
});

describe("SVC-089 appeal domain — filing window + order outcome", () => {
  it("default window is 30 days", () => { expect(DEFAULT_FILING_WINDOW_DAYS).toBe(30); });
  it("allows filing on the deadline day, rejects after", () => {
    const decision = new Date("2026-06-01T00:00:00Z");
    expect(() => assertWithinFilingWindow(decision, 30, new Date("2026-07-01T23:00:00Z"))).not.toThrow();
    expect(() => assertWithinFilingWindow(decision, 30, new Date("2026-07-02T00:00:00Z"))).toThrow("FILING_WINDOW_EXPIRED");
  });
  it("computes the filing deadline string", () => {
    expect(assertWithinFilingWindow(new Date("2026-06-01T00:00:00Z"), 10, new Date("2026-06-02T00:00:00Z")).filingDeadline).toBe("2026-06-11");
  });
  it("orderOutcome maps remand vs decided", () => {
    expect(orderOutcome("remanded")).toEqual({ status: "remanded", outcome: "remanded" });
    expect(orderOutcome("upheld")).toEqual({ status: "decided", outcome: "upheld" });
  });
  it("canIssueOrder only after hearing/assigned", () => {
    expect(canIssueOrder("hearing")).toBe(true);
    expect(canIssueOrder("filed")).toBe(false);
  });
  it("addDays advances the date", () => {
    expect(addDays(new Date("2026-01-01T00:00:00Z"), 5).toISOString().slice(0, 10)).toBe("2026-01-06");
  });
});

describe("SVC-082 intake domain — tracking + assisted", () => {
  it("tracking numbers are unique + formatted", () => {
    const a = buildTrackingNumber(new Date("2026-07-24T00:00:00Z"));
    const b = buildTrackingNumber(new Date("2026-07-24T00:00:00Z"));
    expect(a).toMatch(/^CIT-2026-[0-9A-F]{8}$/);
    expect(a).not.toBe(b);
  });
  it("assisted/counter require an operator; self-service must not carry one", () => {
    expect(isAssistedChannel("assisted")).toBe(true);
    expect(isAssistedChannel("portal")).toBe(false);
    expect(resolveAssistedBy("assisted", "op-1")).toBe("op-1");
    expect(() => resolveAssistedBy("counter", undefined)).toThrow("ASSISTED_OPERATOR_REQUIRED");
    expect(resolveAssistedBy("portal", undefined)).toBeNull();
  });
});
