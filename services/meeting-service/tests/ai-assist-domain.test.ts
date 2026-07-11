/**
 * AI-assist module — pure domain unit tests (task 17.1, no DB / no I/O).
 *
 * Locks the two safety invariants that dominate the AI-assist feature:
 *   1. Confidence gate (Req 16.6): a transcription is authoritative only when confidence ≥ 0.70.
 *   2. Human-approval invariant "AI never auto-publishes" (Req 16.5, P37): AI minutes are ALWAYS
 *      created as an editable `draft` marked `ai_generated = true` and can never be produced in a
 *      human-authorised (approved/signed/circulated) state; extracted actions are advisory
 *      `pending_confirmation` candidates.
 *
 * _Requirements: 7.2, 16.2, 16.3, 16.5, 16.6, 16.7_
 */
import { describe, it, expect } from "vitest";
import {
  AI_CONFIDENCE_THRESHOLD,
  AI_MINUTES_INITIAL_STATUS,
  normalizeConfidence,
  meetsConfidenceThreshold,
  isHumanAuthorisedMinutesStatus,
  buildAiMinutesDraft,
  assertAiMinutesNeverAutoApproved,
  buildActionCandidateArtifact,
  computeHash,
  transcriptStorageKey,
  actionCandidatesStorageKey,
  classifyMatch,
  type ActionCandidate,
} from "../src/modules/ai-assist/domain.js";
import { HttpError } from "../src/shared/context.js";

describe("normalizeConfidence", () => {
  it("clamps out-of-range values into [0,1]", () => {
    expect(normalizeConfidence(-0.5)).toBe(0);
    expect(normalizeConfidence(1.5)).toBe(1);
    expect(normalizeConfidence(0.42)).toBe(0.42);
  });

  it("treats non-finite input as 0 (a broken provider is never high-confidence)", () => {
    expect(normalizeConfidence(Number.NaN)).toBe(0);
    expect(normalizeConfidence(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("meetsConfidenceThreshold (confidence gate, Req 16.6)", () => {
  it("accepts at and above the 0.70 threshold", () => {
    expect(AI_CONFIDENCE_THRESHOLD).toBe(0.7);
    expect(meetsConfidenceThreshold(0.7)).toBe(true);
    expect(meetsConfidenceThreshold(0.95)).toBe(true);
  });

  it("rejects below the threshold (routes to manual fallback)", () => {
    expect(meetsConfidenceThreshold(0.69)).toBe(false);
    expect(meetsConfidenceThreshold(0)).toBe(false);
    expect(meetsConfidenceThreshold(Number.NaN)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(meetsConfidenceThreshold(0.8, 0.9)).toBe(false);
    expect(meetsConfidenceThreshold(0.95, 0.9)).toBe(true);
  });
});

describe("buildAiMinutesDraft (human-approval invariant, Req 16.5 / P37)", () => {
  it("always pins status=draft and aiGenerated=true regardless of input", () => {
    const draft = buildAiMinutesDraft("some content", "verbatim");
    expect(draft.status).toBe(AI_MINUTES_INITIAL_STATUS);
    expect(draft.status).toBe("draft");
    expect(draft.aiGenerated).toBe(true);
    expect(draft.templateType).toBe("verbatim");
    expect(draft.content).toBe("some content");
  });

  it("defaults an unrecognised template to summary", () => {
    expect(buildAiMinutesDraft("x", "bogus").templateType).toBe("summary");
    expect(buildAiMinutesDraft("x").templateType).toBe("summary");
  });
});

describe("isHumanAuthorisedMinutesStatus / assertAiMinutesNeverAutoApproved", () => {
  it("flags approved/signed/circulated as human-authorised", () => {
    expect(isHumanAuthorisedMinutesStatus("approved")).toBe(true);
    expect(isHumanAuthorisedMinutesStatus("signed")).toBe(true);
    expect(isHumanAuthorisedMinutesStatus("circulated")).toBe(true);
    expect(isHumanAuthorisedMinutesStatus("draft")).toBe(false);
    expect(isHumanAuthorisedMinutesStatus("submitted")).toBe(false);
  });

  it("throws 422 when AI would touch a published minutes, passes for editable states", () => {
    expect(() => assertAiMinutesNeverAutoApproved("draft")).not.toThrow();
    expect(() => assertAiMinutesNeverAutoApproved("submitted")).not.toThrow();
    try {
      assertAiMinutesNeverAutoApproved("approved");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(422);
      expect((err as HttpError).code).toBe("MEETING_INVALID_TRANSITION");
    }
  });
});

describe("buildActionCandidateArtifact (pending confirmation, P37)", () => {
  it("marks the artifact pending_confirmation + aiGenerated and normalises candidates", () => {
    const now = new Date("2026-01-02T03:04:05.000Z");
    const raw: ActionCandidate[] = [
      { description: "  Circulate the draft  ", assigneeHint: "Rao", deadlineHint: "next week", confidence: 1.4 },
      { description: "", confidence: 0.9 }, // dropped (blank)
      { description: "File the report", confidence: -1 },
    ];
    const artifact = buildActionCandidateArtifact("meeting-1", raw, now);
    expect(artifact.status).toBe("pending_confirmation");
    expect(artifact.aiGenerated).toBe(true);
    expect(artifact.generatedAt).toBe(now.toISOString());
    expect(artifact.candidates).toHaveLength(2);
    expect(artifact.candidates[0]).toMatchObject({ description: "Circulate the draft", assigneeHint: "Rao", deadlineHint: "next week", confidence: 1 });
    expect(artifact.candidates[1]).toMatchObject({ description: "File the report", confidence: 0 });
  });
});

describe("computeHash + storage keys", () => {
  it("computes a stable 64-char sha256 hex", () => {
    const h = computeHash("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeHash("hello")).toBe(h);
    expect(computeHash("world")).not.toBe(h);
  });

  it("builds tenant/meeting-scoped storage keys", () => {
    expect(transcriptStorageKey("t1", "m1")).toBe("ai/transcripts/t1/m1.txt");
    expect(actionCandidatesStorageKey("t1", "m1")).toBe("ai/action-candidates/t1/m1.json");
  });
});

describe("classifyMatch (Req 16.7 — exact vs semantic 'related match')", () => {
  it("marks a hit whose title/content contains a query term as exact", () => {
    expect(classifyMatch("budget policy", "Budget Circular", "annual plan")).toBe("exact");
    expect(classifyMatch("procurement", "Notes", "procurement approved")).toBe("exact");
  });

  it("marks a hit with no term overlap as a semantic related match", () => {
    expect(classifyMatch("budget", "Vendor onboarding", "supplier registration")).toBe("semantic");
  });

  it("falls back to semantic when the query has no usable terms", () => {
    expect(classifyMatch("a to", "anything", "here")).toBe("semantic");
  });
});
