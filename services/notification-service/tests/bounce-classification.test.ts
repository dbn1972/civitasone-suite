/**
 * INT-12 — hard/soft bounce classification, threshold resolution and the
 * suppression decision. Pure domain: no DB, no queue, no network.
 *
 * The classification rules are the whole point of the requirement — a false
 * hard bounce permanently blocks a legitimate recipient, and a missed hard
 * bounce keeps hammering a dead mailbox and damages sender reputation. Every
 * branch and both documented deviations from the naive first-digit read are
 * covered here.
 */
import { describe, it, expect } from "vitest";
import {
  classifyBounce,
  resolveSoftBounceThreshold,
  decideSuppression,
  DEFAULT_SOFT_BOUNCE_THRESHOLD,
  type BounceClassification,
} from "../src/modules/bounces/domain.js";

describe("classifyBounce — enhanced status codes (RFC 3463)", () => {
  it("5.1.1 user unknown is a hard bounce", () => {
    expect(classifyBounce({ smtpCode: "5.1.1" })).toBe<BounceClassification>("hard");
  });

  it("5.1.2 bad domain is a hard bounce", () => {
    expect(classifyBounce({ smtpCode: "5.1.2" })).toBe("hard");
  });

  it("4.2.1 mailbox disabled temporarily is a soft bounce", () => {
    expect(classifyBounce({ smtpCode: "4.2.1" })).toBe("soft");
  });

  it("4.4.1 no answer from host is a soft bounce", () => {
    expect(classifyBounce({ smtpCode: "4.4.1" })).toBe("soft");
  });

  it("2.0.0 is a success code, not a bounce → unknown", () => {
    expect(classifyBounce({ smtpCode: "2.0.0" })).toBe("unknown");
  });

  it("extracts the enhanced status from a full DSN line", () => {
    expect(classifyBounce({ smtpCode: "smtp; 550 5.1.1 recipient rejected" })).toBe("hard");
  });
});

describe("classifyBounce — documented deviations from the first-digit rule", () => {
  it("5.2.2 mailbox full is SOFT despite the permanent 5.x code", () => {
    // Permanent code describing a temporary condition — the mailbox can be
    // emptied, so suppressing the address would be wrong.
    expect(classifyBounce({ smtpCode: "5.2.2" })).toBe("soft");
  });

  it("5.3.1 mail system full is SOFT", () => {
    expect(classifyBounce({ smtpCode: "5.3.1" })).toBe("soft");
  });

  it("5.3.4 message too big for system is SOFT — the address is fine", () => {
    expect(classifyBounce({ smtpCode: "5.3.4" })).toBe("soft");
  });

  it("4.1.1 unknown mailbox is HARD despite the transient 4.x code", () => {
    expect(classifyBounce({ smtpCode: "4.1.1" })).toBe("hard");
  });

  it("4.7.1 policy/reputation block stays SOFT (retryable)", () => {
    expect(classifyBounce({ smtpCode: "4.7.1", reason: "blocked for reputation" })).toBe("soft");
  });
});

describe("classifyBounce — code and reason interaction", () => {
  it("a 5.x code with an explicit 'mailbox full' reason is downgraded to soft", () => {
    expect(classifyBounce({ smtpCode: "5.0.0", reason: "Mailbox full, try later" })).toBe("soft");
  });

  it("a 4.x code with an explicit 'user unknown' reason is upgraded to hard", () => {
    expect(classifyBounce({ smtpCode: "4.0.0", reason: "550 user unknown" })).toBe("hard");
  });

  it("a 5.x code with a reason that classifies as hard stays hard", () => {
    expect(classifyBounce({ smtpCode: "5.1.1", reason: "no such user" })).toBe("hard");
  });

  it("a 5.x code with an unclassifiable reason stays hard", () => {
    expect(classifyBounce({ smtpCode: "5.5.0", reason: "something odd happened" })).toBe("hard");
  });

  it("a 4.x code with an unclassifiable reason stays soft", () => {
    expect(classifyBounce({ smtpCode: "4.5.0", reason: "something odd happened" })).toBe("soft");
  });
});

describe("classifyBounce — 3-digit reply codes (RFC 5321)", () => {
  it("550 is hard", () => {
    expect(classifyBounce({ smtpCode: "550" })).toBe("hard");
  });

  it("552 with an over-quota reason is downgraded to soft", () => {
    expect(classifyBounce({ smtpCode: "552", reason: "over quota" })).toBe("soft");
  });

  it("451 is soft", () => {
    expect(classifyBounce({ smtpCode: "451" })).toBe("soft");
  });

  it("452 with a 'no such recipient' reason is upgraded to hard", () => {
    expect(classifyBounce({ smtpCode: "452", reason: "no such recipient here" })).toBe("hard");
  });

  it("250 is a success reply, not a bounce → unknown", () => {
    expect(classifyBounce({ smtpCode: "250" })).toBe("unknown");
  });

  it("a code with no recognisable number falls through to the reason", () => {
    expect(classifyBounce({ smtpCode: "BOUNCE", reason: "user unknown" })).toBe("hard");
  });

  it("a code with no recognisable number and no reason is unknown", () => {
    expect(classifyBounce({ smtpCode: "BOUNCE" })).toBe("unknown");
  });
});

describe("classifyBounce — reason-only classification", () => {
  const hardReasons = [
    "User unknown",
    "unknown user",
    "No such user here",
    "no such recipient",
    "Recipient address rejected: access denied",
    "the mailbox does not exist",
    "invalid recipient",
    "address rejected",
    "unrouteable address",
    "Mailbox unavailable",
    "account disabled",
    "This account has been disabled",
  ];
  for (const reason of hardReasons) {
    it(`"${reason}" → hard`, () => {
      expect(classifyBounce({ reason })).toBe("hard");
    });
  }

  const softReasons = [
    "mailbox full",
    "over quota",
    "Quota exceeded",
    "insufficient storage",
    "please try again later",
    "temporarily deferred",
    "temporary failure",
    "greylist in effect",
    "greylisted",
    "connection timed out",
    "too many connections from your host",
    "rate limited",
    "throttled",
    "service unavailable",
  ];
  for (const reason of softReasons) {
    it(`"${reason}" → soft`, () => {
      expect(classifyBounce({ reason })).toBe("soft");
    });
  }

  it("hard patterns win over a trailing generic 'try again later' boilerplate", () => {
    expect(classifyBounce({ reason: "Mailbox unavailable. Please try again later." })).toBe("hard");
  });

  it("an unrecognised reason is unknown — never guessed", () => {
    expect(classifyBounce({ reason: "the server did something inexplicable" })).toBe("unknown");
  });
});

describe("classifyBounce — empty and absent signals", () => {
  it("no signal at all is unknown", () => {
    expect(classifyBounce({})).toBe("unknown");
  });

  it("explicit nulls are unknown", () => {
    expect(classifyBounce({ smtpCode: null, reason: null })).toBe("unknown");
  });

  it("whitespace-only signals are unknown", () => {
    expect(classifyBounce({ smtpCode: "   ", reason: "  " })).toBe("unknown");
  });

  it("undefined signals are unknown", () => {
    expect(classifyBounce({ smtpCode: undefined, reason: undefined })).toBe("unknown");
  });
});

describe("resolveSoftBounceThreshold", () => {
  it("uses the per-tenant setting when it is a positive integer", () => {
    expect(resolveSoftBounceThreshold(3, {})).toBe(3);
  });

  it("ignores a zero tenant setting — 0 would suppress on the first soft bounce", () => {
    expect(resolveSoftBounceThreshold(0, {})).toBe(DEFAULT_SOFT_BOUNCE_THRESHOLD);
  });

  it("ignores a negative tenant setting", () => {
    expect(resolveSoftBounceThreshold(-2, {})).toBe(DEFAULT_SOFT_BOUNCE_THRESHOLD);
  });

  it("ignores a non-integer tenant setting", () => {
    expect(resolveSoftBounceThreshold(2.5, {})).toBe(DEFAULT_SOFT_BOUNCE_THRESHOLD);
  });

  it("falls back to the env var when there is no tenant setting", () => {
    expect(resolveSoftBounceThreshold(null, { NOTIFICATION_SOFT_BOUNCE_THRESHOLD: "7" })).toBe(7);
  });

  it("tenant setting beats the env var", () => {
    expect(resolveSoftBounceThreshold(2, { NOTIFICATION_SOFT_BOUNCE_THRESHOLD: "7" })).toBe(2);
  });

  it("ignores a blank env var", () => {
    expect(resolveSoftBounceThreshold(undefined, { NOTIFICATION_SOFT_BOUNCE_THRESHOLD: "  " }))
      .toBe(DEFAULT_SOFT_BOUNCE_THRESHOLD);
  });

  it("ignores a non-numeric env var", () => {
    expect(resolveSoftBounceThreshold(undefined, { NOTIFICATION_SOFT_BOUNCE_THRESHOLD: "many" }))
      .toBe(DEFAULT_SOFT_BOUNCE_THRESHOLD);
  });

  it("ignores a zero env var", () => {
    expect(resolveSoftBounceThreshold(undefined, { NOTIFICATION_SOFT_BOUNCE_THRESHOLD: "0" }))
      .toBe(DEFAULT_SOFT_BOUNCE_THRESHOLD);
  });

  it("defaults to 5 with nothing configured", () => {
    expect(resolveSoftBounceThreshold(undefined, {})).toBe(5);
  });

  it("reads process.env when no env object is passed", () => {
    // The default parameter path — asserted so the branch is exercised.
    expect(resolveSoftBounceThreshold(4)).toBe(4);
  });
});

describe("decideSuppression", () => {
  it("a hard bounce suppresses immediately, whatever the soft count", () => {
    expect(decideSuppression("hard", 0, 5)).toEqual({ suppress: true, reason: "hard_bounce" });
  });

  it("an unknown bounce NEVER suppresses — a false hard bounce blocks a real recipient", () => {
    expect(decideSuppression("unknown", 99, 5)).toEqual({ suppress: false, reason: "not_a_bounce" });
  });

  it("a soft bounce below the threshold does not suppress", () => {
    expect(decideSuppression("soft", 4, 5)).toEqual({ suppress: false, reason: "transient" });
  });

  it("a soft bounce AT the threshold suppresses (count includes the current bounce)", () => {
    expect(decideSuppression("soft", 5, 5)).toEqual({ suppress: true, reason: "soft_bounce_threshold" });
  });

  it("a soft bounce above the threshold suppresses", () => {
    expect(decideSuppression("soft", 12, 5)).toEqual({ suppress: true, reason: "soft_bounce_threshold" });
  });

  it("a threshold of 1 suppresses on the first soft bounce", () => {
    expect(decideSuppression("soft", 1, 1)).toEqual({ suppress: true, reason: "soft_bounce_threshold" });
  });
});
