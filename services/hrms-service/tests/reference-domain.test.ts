import { describe, it, expect } from "vitest";
import {
  validateReservationAttributes, validateReferences, validateRelationshipDeclaration, type Reference,
} from "../src/modules/recruitment/reference-domain.js";

describe("validateReservationAttributes", () => {
  it("requires a certificate for a reserved-category claim", () => {
    expect(validateReservationAttributes({ category: "SC", reservationDocs: [] }).some((m) => /certificate/.test(m))).toBe(true);
    expect(validateReservationAttributes({ category: "SC", reservationDocs: ["doc-1"] })).toEqual([]);
    expect(validateReservationAttributes({ category: "GEN", reservationDocs: [] })).toEqual([]); // general needs nothing
  });
  it("requires type + percentage + certificate for a disability claim", () => {
    expect(validateReservationAttributes({ disability: true }).length).toBeGreaterThanOrEqual(2);
    expect(validateReservationAttributes({ disability: true, disabilityType: "visual", disabilityPercentage: 60, reservationDocs: ["d"] })).toEqual([]);
    expect(validateReservationAttributes({ disability: true, disabilityType: "visual", disabilityPercentage: 150, reservationDocs: ["d"] }).some((m) => /percentage/.test(m))).toBe(true);
    expect(validateReservationAttributes({ disability: true, disabilityType: "bogus", disabilityPercentage: 60, reservationDocs: ["d"] }).some((m) => /type/.test(m))).toBe(true);
  });
  it("rejects an unknown category (case-insensitive) but accepts known ones", () => {
    expect(validateReservationAttributes({ category: "XX", reservationDocs: ["d"] }).some((m) => /unknown category/.test(m))).toBe(true);
    expect(validateReservationAttributes({ category: "obc", reservationDocs: ["d"] })).toEqual([]); // lowercase known is fine
    expect(validateReservationAttributes({ category: "GEN" })).toEqual([]);
  });
  it("requires a document for ex-serviceman / freedom-fighter", () => {
    expect(validateReservationAttributes({ exServiceman: true, reservationDocs: [] }).length).toBeGreaterThan(0);
    expect(validateReservationAttributes({ freedomFighterDependent: true, reservationDocs: ["d"] })).toEqual([]);
  });
});

describe("validateReferences", () => {
  const R = (name: string, over: Partial<Reference> = {}): Reference => ({ name, relationship: "former manager", email: `${name}@x.in`, ...over });
  it("requires at least two references", () => {
    expect(validateReferences([R("A")]).some((m) => /at least two/.test(m))).toBe(true);
    expect(validateReferences([R("A"), R("B")])).toEqual([]);
  });
  it("requires a name, relationship and a contact channel", () => {
    expect(validateReferences([R("A", { relationship: "" }), R("B")]).some((m) => /relationship/.test(m))).toBe(true);
    expect(validateReferences([R("A", { email: undefined, phone: undefined }), R("B")]).some((m) => /email or phone/.test(m))).toBe(true);
  });
  it("rejects duplicate references (same email or phone)", () => {
    expect(validateReferences([R("A", { email: "same@x.in" }), R("B", { email: "same@x.in" })]).some((m) => /duplicate/.test(m))).toBe(true);
  });
  it("rejects a reference that is the candidate", () => {
    expect(validateReferences([R("A", { email: "cand@x.in" }), R("B")], { email: "cand@x.in" }).some((m) => /cannot be the candidate/.test(m))).toBe(true);
  });
});

describe("validateRelationshipDeclaration", () => {
  it("requires named relations when a prior relationship is declared", () => {
    expect(validateRelationshipDeclaration({ hasPriorRelationship: true }).length).toBeGreaterThan(0);
    expect(validateRelationshipDeclaration({ hasPriorRelationship: true, relations: [{ personName: "X", nature: "former colleague" }] })).toEqual([]);
    expect(validateRelationshipDeclaration({ hasPriorRelationship: true, relations: [{ personName: "", nature: "x" }] }).some((m) => /person name/.test(m))).toBe(true);
  });
  it("accepts a clean no-relationship declaration", () => {
    expect(validateRelationshipDeclaration({ hasPriorRelationship: false })).toEqual([]);
  });
});
