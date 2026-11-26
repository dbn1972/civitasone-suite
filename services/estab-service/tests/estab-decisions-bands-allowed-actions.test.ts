/**
 * B22 (overlapping amount bands) and B23 (who may submit / sign): pure-function cases, no database.
 */
import { describe, it, expect } from "vitest";
import { bandsOverlap, findOverlappingRule } from "../src/modules/approval-rules/bands.js";
import { computeAllowedActions, latestDraft, latestUnsigned, type NotingLite } from "../src/modules/files/allowedActions.js";

describe("B22 bandsOverlap (half-open [min, max), null max = open-ended)", () => {
  it("adjacent bands do not overlap", () => {
    expect(bandsOverlap({ minAmountMinor: 0, maxAmountMinor: 10_000_000 }, { minAmountMinor: 10_000_000, maxAmountMinor: 50_000_000 })).toBe(false);
  });
  it("a shared rupee overlaps", () => {
    expect(bandsOverlap({ minAmountMinor: 0, maxAmountMinor: 20_000_000 }, { minAmountMinor: 10_000_000, maxAmountMinor: 50_000_000 })).toBe(true);
  });
  it("an open-ended band overlaps anything above its minimum", () => {
    expect(bandsOverlap({ minAmountMinor: 50_000_000, maxAmountMinor: null }, { minAmountMinor: 90_000_000, maxAmountMinor: 95_000_000 })).toBe(true);
    expect(bandsOverlap({ minAmountMinor: 50_000_000, maxAmountMinor: null }, { minAmountMinor: 0, maxAmountMinor: 50_000_000 })).toBe(false);
  });
  it("findOverlappingRule skips the rule being edited", () => {
    const rules = [
      { id: "a", label: "Up to 1 lakh", minAmountMinor: 0, maxAmountMinor: 10_000_000 },
      { id: "b", label: "1 to 5 lakh", minAmountMinor: 10_000_000, maxAmountMinor: 50_000_000 },
    ];
    expect(findOverlappingRule(rules, { minAmountMinor: 10_000_000, maxAmountMinor: 50_000_000 }, "b")).toBeNull();
    expect(findOverlappingRule(rules, { minAmountMinor: 5_000_000, maxAmountMinor: 20_000_000 }, "b")?.id).toBe("a");
  });
});

const AUTHOR = "aaaaaaaa-0000-4000-8000-000000000001";
const APPROVER = "aaaaaaaa-0000-4000-8000-000000000002";
const n = (over: Partial<NotingLite>): NotingLite => ({
  id: "n1", officerId: AUTHOR, noteType: "yellow", noteStatus: "draft", eSigned: false, createdAt: "2026-11-20T10:00:00Z", ...over,
});

describe("B23 computeAllowedActions", () => {
  it("the author of a draft may submit but not sign", () => {
    expect(computeAllowedActions({ notings: [n({})], actorId: AUTHOR, readOnly: false, holdsOpenTask: false })).toEqual({ canSubmit: true, canSign: false });
  });
  it("another officer may not submit someone else's draft", () => {
    expect(computeAllowedActions({ notings: [n({})], actorId: APPROVER, readOnly: false, holdsOpenTask: false }).canSubmit).toBe(false);
  });
  it("the current approver may sign a submitted note", () => {
    const notings = [n({ noteStatus: "submitted" })];
    expect(computeAllowedActions({ notings, actorId: APPROVER, readOnly: false, holdsOpenTask: true })).toEqual({ canSubmit: false, canSign: true });
  });
  it("an unreachable workflow (null) never grants signing", () => {
    expect(computeAllowedActions({ notings: [n({ noteStatus: "submitted" })], actorId: APPROVER, readOnly: false, holdsOpenTask: null }).canSign).toBe(false);
  });
  it("a closed file allows nothing", () => {
    expect(computeAllowedActions({ notings: [n({})], actorId: AUTHOR, readOnly: true, holdsOpenTask: true })).toEqual({ canSubmit: false, canSign: false });
  });
  it("with two drafts the latest one is the target", () => {
    const older = n({ id: "old", createdAt: "2026-11-18T09:00:00Z" });
    const newer = n({ id: "new", createdAt: "2026-11-21T09:00:00Z", officerId: APPROVER });
    expect(latestDraft([older, newer])?.id).toBe("new");
    expect(computeAllowedActions({ notings: [older, newer], actorId: AUTHOR, readOnly: false, holdsOpenTask: false }).canSubmit).toBe(false);
  });
  it("the sign target is the highest-seq unsigned note, not any unsigned note", () => {
    const old = n({ id: "old", seq: 1, noteStatus: "submitted" });
    const cur = n({ id: "cur", seq: 2 });
    expect(latestUnsigned([old, cur])?.id).toBe("cur");
  });
  it("signed notes are not awaiting a signature", () => {
    expect(latestUnsigned([n({ noteStatus: "approved", eSigned: true, noteType: "green" })])).toBeNull();
  });
});
