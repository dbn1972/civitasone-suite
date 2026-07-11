/**
 * Minutes module — domain unit tests + hash-chain property tests (task 9.4 · P23, P24).
 *
 * Two layers:
 *   1. Unit tests for every pure function in minutes/domain.ts — template rendering
 *      (verbatim / summary / resolution_only, all branches), version diff (LCS), the minutes
 *      status machine + `minutes_approved` immutability invariant, the rejection edge, the
 *      submission-deadline window + alerts, and the hash primitives — exercising all branches.
 *   2. Property tests (P23 hash-chain integrity, P24 signed-document immutability) driven by a
 *      deterministic seeded PRNG over hundreds of generated committee chains. No PBT library is
 *      used because no sibling test in this service does (steering: no new deps without approval);
 *      the seeded generator gives the same "hold across all inputs" guarantee, reproducibly.
 *
 * **Validates: Requirements 8.5, 16.2** (P23, P24). Also covers Req 7.1, 7.2, 7.5, 7.6, 7.7, 7.8.
 */
import { describe, it, expect } from "vitest";
import {
  MINUTES_TEMPLATE_TYPES,
  MINUTES_STATUSES,
  isMinutesTemplateType,
  isMinutesStatus,
  computeMinutesSubmissionDeadline,
  isMinutesOverdue,
  computeMinutesDeadlineAlerts,
  DEFAULT_MINUTES_SUBMISSION_DEADLINE_DAYS,
  MINUTES_DEADLINE_ALERT_LEAD_DAYS,
  isMinutesLocked,
  assertMinutesEditable,
  canMinutesTransition,
  assertMinutesTransition,
  computeHash,
  linkHashChain,
  verifyChain,
  diffMinutes,
  summarizeDiff,
  renderMinutesTemplate,
  type ChainRecord,
  type MinutesStatus,
} from "../src/modules/minutes/domain.js";
import { HttpError } from "../src/shared/context.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Deterministic PRNG (mulberry32) — reproducible generators, no PBT dep ───

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randContent(rnd: () => number): string {
  const lineCount = 1 + Math.floor(rnd() * 8);
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    // Include a mix of characters, unicode, and markdown-ish content.
    const n = Math.floor(rnd() * 1e9).toString(36);
    lines.push(`§${i} resolution ${n} — ₹${Math.floor(rnd() * 1000)} <&> "quorum"`);
  }
  return lines.join("\n");
}

// ─── Type guards + vocabularies ──────────────────────────────────────────────

describe("template + status vocabularies", () => {
  it("recognises every declared template type and rejects others", () => {
    for (const t of MINUTES_TEMPLATE_TYPES) expect(isMinutesTemplateType(t)).toBe(true);
    expect(isMinutesTemplateType("bogus")).toBe(false);
    expect(isMinutesTemplateType("")).toBe(false);
  });

  it("recognises every declared status and rejects others", () => {
    for (const s of MINUTES_STATUSES) expect(isMinutesStatus(s)).toBe(true);
    expect(isMinutesStatus("archived")).toBe(false);
  });
});

// ─── Submission deadline + alerts (Req 7.7) ──────────────────────────────────

describe("submission deadline + alerts (Req 7.7)", () => {
  const meeting = new Date("2026-03-01T10:00:00.000Z");

  it("defaults to 7 days after the meeting", () => {
    const d = computeMinutesSubmissionDeadline(meeting);
    expect(d.getTime()).toBe(meeting.getTime() + DEFAULT_MINUTES_SUBMISSION_DEADLINE_DAYS * MS_PER_DAY);
  });

  it("honours a finite non-negative configured window", () => {
    const d = computeMinutesSubmissionDeadline(meeting, { submissionDeadlineDays: 3 });
    expect(d.getTime()).toBe(meeting.getTime() + 3 * MS_PER_DAY);
  });

  it("falls back to the default for an invalid / negative window", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const d = computeMinutesSubmissionDeadline(meeting, { submissionDeadlineDays: bad });
      expect(d.getTime()).toBe(meeting.getTime() + DEFAULT_MINUTES_SUBMISSION_DEADLINE_DAYS * MS_PER_DAY);
    }
  });

  it("detects overdue strictly past the deadline", () => {
    const deadline = computeMinutesSubmissionDeadline(meeting);
    expect(isMinutesOverdue(deadline, new Date(deadline.getTime() - 1))).toBe(false);
    expect(isMinutesOverdue(deadline, deadline)).toBe(false);
    expect(isMinutesOverdue(deadline, new Date(deadline.getTime() + 1))).toBe(true);
  });

  it("computes the two alert points with the default and a custom lead", () => {
    const deadline = new Date("2026-03-08T10:00:00.000Z");
    const def = computeMinutesDeadlineAlerts(deadline);
    expect(def.onDeadline.getTime()).toBe(deadline.getTime());
    expect(def.twoDaysBefore.getTime()).toBe(deadline.getTime() - MINUTES_DEADLINE_ALERT_LEAD_DAYS * MS_PER_DAY);

    const custom = computeMinutesDeadlineAlerts(deadline, 5);
    expect(custom.twoDaysBefore.getTime()).toBe(deadline.getTime() - 5 * MS_PER_DAY);
  });

  it("clamps a negative lead to zero (alert on the deadline)", () => {
    const deadline = new Date("2026-03-08T10:00:00.000Z");
    const a = computeMinutesDeadlineAlerts(deadline, -3);
    expect(a.twoDaysBefore.getTime()).toBe(deadline.getTime());
  });
});

// ─── Status machine + minutes_approved invariant (Req 7.5, 7.6) ──────────────

describe("minutes status machine + immutability invariant (Req 7.5, 7.6)", () => {
  it("locks content once approved / signed / circulated, not before", () => {
    expect(isMinutesLocked("draft")).toBe(false);
    expect(isMinutesLocked("submitted")).toBe(false);
    expect(isMinutesLocked("approved")).toBe(true);
    expect(isMinutesLocked("signed")).toBe(true);
    expect(isMinutesLocked("circulated")).toBe(true);
  });

  it("assertMinutesEditable passes for editable states and throws (422) once locked", () => {
    expect(() => assertMinutesEditable("draft")).not.toThrow();
    expect(() => assertMinutesEditable("submitted")).not.toThrow();
    for (const locked of ["approved", "signed", "circulated"]) {
      try {
        assertMinutesEditable(locked);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).code).toBe("MEETING_INVALID_TRANSITION");
      }
    }
  });

  it("accepts exactly the legal transitions, including the submitted→draft rejection edge", () => {
    const legal: Array<[MinutesStatus, MinutesStatus]> = [
      ["draft", "submitted"],
      ["submitted", "approved"],
      ["submitted", "draft"], // rejection edge (Req 7.6)
      ["approved", "signed"],
      ["signed", "circulated"],
    ];
    for (const [from, to] of legal) expect(canMinutesTransition(from, to)).toBe(true);
  });

  it("rejects illegal transitions (no path back out of a locked document)", () => {
    const illegal: Array<[MinutesStatus, MinutesStatus]> = [
      ["draft", "approved"],
      ["draft", "signed"],
      ["approved", "draft"],
      ["signed", "approved"],
      ["circulated", "signed"],
      ["submitted", "signed"],
    ];
    for (const [from, to] of illegal) expect(canMinutesTransition(from, to)).toBe(false);
  });

  it("assertMinutesTransition throws (422) with the allowed targets for an illegal move", () => {
    try {
      assertMinutesTransition("approved", "draft");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const e = err as HttpError;
      expect(e.code).toBe("MEETING_INVALID_TRANSITION");
      expect((e.details as { allowed: string[] }).allowed).toEqual(["signed"]);
    }
    expect(() => assertMinutesTransition("draft", "submitted")).not.toThrow();
  });
});

// ─── Hash primitives (Req 8.5) ───────────────────────────────────────────────

describe("hash primitives", () => {
  it("computeHash is a deterministic 64-char lowercase hex SHA-256", () => {
    const h = computeHash("hello minutes");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeHash("hello minutes")).toBe(h);
    expect(computeHash("hello minutez")).not.toBe(h);
  });

  it("linkHashChain sets genesis hashPrevious=null and links to a supplied predecessor", () => {
    const genesis = linkHashChain("content-A", null);
    expect(genesis.hashPrevious).toBeNull();
    expect(genesis.hashCurrent).toBe(computeHash("content-A"));

    const linked = linkHashChain("content-B", genesis.hashCurrent);
    expect(linked.hashPrevious).toBe(genesis.hashCurrent);
    expect(linked.hashCurrent).toBe(computeHash("content-B"));

    // undefined predecessor is normalised to null (genesis).
    expect(linkHashChain("x", undefined).hashPrevious).toBeNull();
  });

  it("verifyChain reports an empty chain as vacuously valid", () => {
    expect(verifyChain([])).toEqual({ valid: true });
  });

  it("verifyChain flags a content_hash_mismatch at the tampered index", () => {
    const a = linkHashChain("a", null);
    const b = linkHashChain("b", a.hashCurrent);
    const records: ChainRecord[] = [
      { content: "a", hashPrevious: a.hashPrevious, hashCurrent: a.hashCurrent },
      { content: "b-TAMPERED", hashPrevious: b.hashPrevious, hashCurrent: b.hashCurrent },
    ];
    expect(verifyChain(records)).toEqual({ valid: false, brokenAt: 1, reason: "content_hash_mismatch" });
  });

  it("verifyChain flags a chain_link_broken when a link does not point at its predecessor", () => {
    const a = linkHashChain("a", null);
    const b = linkHashChain("b", "deadbeef"); // wrong predecessor
    const records: ChainRecord[] = [
      { content: "a", hashPrevious: a.hashPrevious, hashCurrent: a.hashCurrent },
      { content: "b", hashPrevious: b.hashPrevious, hashCurrent: b.hashCurrent },
    ];
    expect(verifyChain(records)).toEqual({ valid: false, brokenAt: 1, reason: "chain_link_broken" });
  });
});

// ─── Version diff (Req 7.8) ──────────────────────────────────────────────────

describe("diffMinutes + summarizeDiff (Req 7.8)", () => {
  it("marks identical content entirely unchanged", () => {
    const diff = diffMinutes("l1\nl2\nl3", "l1\nl2\nl3");
    expect(diff.every((d) => d.op === "unchanged")).toBe(true);
    expect(summarizeDiff(diff)).toEqual({ added: 0, removed: 0, unchanged: 3 });
  });

  it("captures an inserted and a removed line via the LCS walk", () => {
    // old: A B C   new: A X C  → B removed, X added, A/C unchanged.
    const diff = diffMinutes("A\nB\nC", "A\nX\nC");
    const s = summarizeDiff(diff);
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.unchanged).toBe(2);
  });

  it("treats a pure append as added-only, and a pure delete as removed-only", () => {
    expect(summarizeDiff(diffMinutes("A", "A\nB\nC"))).toEqual({ added: 2, removed: 0, unchanged: 1 });
    expect(summarizeDiff(diffMinutes("A\nB\nC", "A"))).toEqual({ added: 0, removed: 2, unchanged: 1 });
  });

  it("reconstructs the new document from unchanged+added lines (round-trip)", () => {
    const rnd = mulberry32(99);
    for (let iter = 0; iter < 50; iter++) {
      const oldC = randContent(rnd);
      const newC = randContent(rnd);
      const diff = diffMinutes(oldC, newC);
      const reconstructed = diff.filter((d) => d.op !== "removed").map((d) => d.text).join("\n");
      expect(reconstructed).toBe(newC);
      const original = diff.filter((d) => d.op !== "added").map((d) => d.text).join("\n");
      expect(original).toBe(oldC);
    }
  });
});

// ─── Template rendering (Req 7.1, 7.2) ───────────────────────────────────────

const renderData = {
  meeting: {
    title: "Board Meeting",
    meetingNumber: "MTG/2025-26/007",
    committeeName: "Audit Committee",
    venue: "Room 1",
    scheduledAt: new Date("2026-02-01T09:00:00.000Z"),
    actualStartAt: new Date("2026-02-01T09:05:00.000Z"),
    actualEndAt: new Date("2026-02-01T10:30:00.000Z"),
  },
  attendees: [
    { name: "emp-1", role: "chairperson", status: "present", mode: "in_person" },
    { name: "emp-2", role: "member", status: "joined_late", mode: "vc" },
  ],
  agendaItems: [
    { sequence: 2, title: "Budget review", outcomeType: "decision", discussion: "detailed talk", decision: "approved" },
    { sequence: 1, title: "Confirm prior minutes", outcomeType: "noting", discussion: "", decision: "" },
  ],
  resolutions: [
    { resolutionNumber: "RES/1", text: "Approve budget", votesFor: 5, votesAgainst: 0, votesAbstain: 1, result: "passed" },
  ],
};

describe("renderMinutesTemplate (Req 7.1, 7.2)", () => {
  it("verbatim renders header, attendance, every agenda item WITH discussion, and resolutions", () => {
    const out = renderMinutesTemplate("verbatim", renderData);
    expect(out).toContain("# Minutes: Board Meeting");
    expect(out).toContain("Meeting No.: MTG/2025-26/007");
    expect(out).toContain("Committee: Audit Committee");
    expect(out).toContain("## Attendance");
    expect(out).toContain("- emp-1 (chairperson) — present [in_person]");
    expect(out).toContain("**Discussion:**");
    expect(out).toContain("detailed talk");
    expect(out).toContain("## Resolutions");
    expect(out).toContain("RES/1: Approve budget (For: 5, Against: 0, Abstain: 1) — passed");
    // Ordering: sequence 1 must appear before sequence 2.
    expect(out.indexOf("Confirm prior minutes")).toBeLessThan(out.indexOf("Budget review"));
    // Empty discussion falls back to the placeholder.
    expect(out).toContain("_To be recorded._");
  });

  it("summary renders attendance + agenda decisions but OMITS the discussion section", () => {
    const out = renderMinutesTemplate("summary", renderData);
    expect(out).toContain("## Attendance");
    expect(out).toContain("## Agenda Items");
    expect(out).toContain("**Decision:**");
    expect(out).not.toContain("**Discussion:**");
    expect(out).toContain("## Resolutions");
  });

  it("resolution_only renders header + resolutions ONLY (no attendance, no agenda)", () => {
    const out = renderMinutesTemplate("resolution_only", renderData);
    expect(out).toContain("# Minutes: Board Meeting");
    expect(out).toContain("## Resolutions");
    expect(out).not.toContain("## Attendance");
    expect(out).not.toContain("## Agenda Items");
  });

  it("renders graceful placeholders for empty attendance / agenda / resolutions", () => {
    const out = renderMinutesTemplate("summary", {
      meeting: { title: "Empty Meeting" },
    });
    expect(out).toContain("Venue: —");
    expect(out).toContain("_No attendance recorded._");
    expect(out).toContain("_No agenda items._");
    expect(out).toContain("_No resolutions recorded._");
  });

  it("defaults vote counts to zero when a resolution omits them", () => {
    const out = renderMinutesTemplate("resolution_only", {
      meeting: { title: "M" },
      resolutions: [{ text: "bare resolution" }],
    });
    expect(out).toContain("bare resolution (For: 0, Against: 0, Abstain: 0)");
  });
});

// ─── P23: Hash chain integrity (property) — Req 8.5, 16.2 ─────────────────────

describe("P23: hash chain integrity (property)", () => {
  it("consecutive linked minutes satisfy minutes[n].hashPrevious == minutes[n-1].hashCurrent, across many chains", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = mulberry32(seed);
      const len = 1 + Math.floor(rnd() * 9); // 1..9 approved minutes in a committee
      const contents = Array.from({ length: len }, () => randContent(rnd));

      // Build the chain exactly as the consumer does: hashPrevious = previous.hashCurrent.
      const records: ChainRecord[] = [];
      let prevHash: string | null = null;
      for (const content of contents) {
        const link = linkHashChain(content, prevHash);
        records.push({ content, hashPrevious: link.hashPrevious, hashCurrent: link.hashCurrent });
        prevHash = link.hashCurrent;
      }

      // Genesis is unconstrained; every subsequent link points at its predecessor (P23).
      expect(records[0]!.hashPrevious).toBeNull();
      for (let n = 1; n < records.length; n++) {
        expect(records[n]!.hashPrevious).toBe(records[n - 1]!.hashCurrent);
      }
      // The whole chain verifies as intact.
      expect(verifyChain(records)).toEqual({ valid: true });
    }
  });

  it("tampering with any single link is detected by verifyChain", () => {
    for (let seed = 1000; seed <= 1150; seed++) {
      const rnd = mulberry32(seed);
      const len = 2 + Math.floor(rnd() * 6); // need ≥2 to break a link
      const records: ChainRecord[] = [];
      let prevHash: string | null = null;
      for (let i = 0; i < len; i++) {
        const content = randContent(rnd);
        const link = linkHashChain(content, prevHash);
        records.push({ content, hashPrevious: link.hashPrevious, hashCurrent: link.hashCurrent });
        prevHash = link.hashCurrent;
      }

      // Break the link at a random non-genesis index by corrupting hashPrevious.
      const target = 1 + Math.floor(rnd() * (len - 1));
      const broken = records.map((r, i) =>
        i === target ? { ...r, hashPrevious: `${r.hashPrevious}0` } : r,
      );
      const result = verifyChain(broken);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(target);
      expect(result.reason).toBe("chain_link_broken");
    }
  });
});

// ─── P24: Signed document immutability (property) — Req 8.5, 16.2 ─────────────

describe("P24: signed document immutability (property)", () => {
  it("for a sealed document, SHA256(content) == hashCurrent, and any content change is detectable", () => {
    for (let seed = 5000; seed <= 5300; seed++) {
      const rnd = mulberry32(seed);
      const content = randContent(rnd);

      // Sealing sets hashCurrent = SHA256(content) (dsc_signature present ⇒ this holds, P24).
      const { hashCurrent } = linkHashChain(content, null);
      expect(hashCurrent).toBe(computeHash(content));

      // A verifier recomputes SHA256(content) and compares — matches for the untampered doc.
      const record: ChainRecord = { content, hashPrevious: null, hashCurrent };
      expect(verifyChain([record])).toEqual({ valid: true });

      // Any post-seal modification of the content is detected (hash no longer matches).
      const tampered = `${content}\n<!-- injected line -->`;
      expect(computeHash(tampered)).not.toBe(hashCurrent);
      expect(verifyChain([{ content: tampered, hashPrevious: null, hashCurrent }])).toEqual({
        valid: false,
        brokenAt: 0,
        reason: "content_hash_mismatch",
      });
    }
  });
});
