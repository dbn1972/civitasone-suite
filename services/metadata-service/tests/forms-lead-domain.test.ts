/**
 * Unit tests for the LM-002 input-safety boundary and the rate limiter. These
 * are the guards standing between an anonymous internet caller and the database,
 * so every bound gets an explicit test.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_ANSWER_LENGTH,
  MAX_BODY_BYTES,
  MAX_UTM_LENGTH,
  UTM_KEYS,
  checkAnswers,
  checkScalar,
  checkUtm,
  containsControlChars,
  containsMarkup,
  describeRejection,
  publicSafeRejectionSummary,
  utmFromUrl,
} from "../src/modules/forms/lead-domain.js";
import { FixedWindowRateLimiter } from "../src/modules/forms/rate-limit.js";
import {
  decryptPii,
  encryptPii,
  isEncrypted,
  maskEmail,
  maskPhone,
  PiiDecryptError,
  resetPiiKeyCache,
} from "../src/shared/pii-crypto.js";

describe("bounds are declared as constants", () => {
  it("keeps the body bound small (32 KiB) — a lead form is not an upload endpoint", () => {
    expect(MAX_BODY_BYTES).toBe(32 * 1024);
  });

  it("bounds UTM values more tightly than answers", () => {
    expect(MAX_UTM_LENGTH).toBeLessThan(MAX_ANSWER_LENGTH);
  });

  it("names all five UTM parameters", () => {
    expect([...UTM_KEYS]).toEqual(["source", "medium", "campaign", "term", "content"]);
  });
});

describe("markup detection", () => {
  it.each([
    "<script>alert(1)</script>",
    "hello <b>world",
    "a > b",
    "&#60;script&#62;",
    "&lt;script&gt;",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,AAAA",
  ])("rejects %s", (value) => {
    expect(containsMarkup(value)).toBe(true);
  });

  it.each(["Rakesh Sharma", "M/s Sharma & Sons", "cost is 5 - 10 lakh", "email me: a@b.com"])(
    "accepts %s",
    (value) => {
      expect(containsMarkup(value)).toBe(false);
    },
  );
});

describe("control character detection", () => {
  it("rejects a NUL byte", () => {
    expect(containsControlChars("abc\u0000def")).toBe(true);
  });

  it("rejects a DEL byte", () => {
    expect(containsControlChars("abc\u007Fdef")).toBe(true);
  });

  it("allows tab, newline and carriage return in a message field", () => {
    expect(containsControlChars("line one\nline two\r\n\tindented")).toBe(false);
  });
});

describe("checkScalar", () => {
  it("accepts null", () => {
    expect(checkScalar("f", null)).toBeNull();
  });

  it("accepts a finite number", () => {
    expect(checkScalar("f", 42)).toBeNull();
  });

  it("rejects NaN and Infinity as unsupported", () => {
    expect(checkScalar("f", Number.NaN)?.reason).toBe("unsupported_type");
    expect(checkScalar("f", Number.POSITIVE_INFINITY)?.reason).toBe("unsupported_type");
  });

  it("accepts a boolean", () => {
    expect(checkScalar("f", true)).toBeNull();
  });

  it("rejects an object", () => {
    expect(checkScalar("f", { nested: 1 })?.reason).toBe("unsupported_type");
  });

  it("rejects an array", () => {
    expect(checkScalar("f", [1, 2])?.reason).toBe("unsupported_type");
  });

  it("rejects an oversized string", () => {
    expect(checkScalar("f", "x".repeat(MAX_ANSWER_LENGTH + 1))?.reason).toBe("too_long");
  });

  it("accepts a string exactly at the bound", () => {
    expect(checkScalar("f", "x".repeat(MAX_ANSWER_LENGTH))).toBeNull();
  });

  it("rejects markup", () => {
    expect(checkScalar("f", "<img onerror=x>")?.reason).toBe("markup_not_allowed");
  });

  it("rejects control characters", () => {
    expect(checkScalar("f", "a\u0001b")?.reason).toBe("control_characters");
  });

  it("honours a custom max length", () => {
    expect(checkScalar("f", "abcdef", 3)?.reason).toBe("too_long");
  });
});

describe("describeRejection never echoes the value", () => {
  it.each([
    "too_long",
    "markup_not_allowed",
    "control_characters",
    "unsupported_type",
    "too_many_fields",
    "unknown_field",
  ] as const)("produces a message for %s", (reason) => {
    const message = describeRejection({ field: "phone", reason });
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain("9876543210");
  });
});

describe("checkAnswers", () => {
  const allowed = ["name", "budget"];

  it("accepts and trims known scalar answers", () => {
    const result = checkAnswers({ name: "  Asha  ", budget: 500 }, allowed);
    expect(result.rejections).toEqual([]);
    expect(result.answers).toEqual({ name: "Asha", budget: 500 });
  });

  it("rejects an unknown field rather than dropping it silently", () => {
    const result = checkAnswers({ name: "Asha", is_admin: true }, allowed);
    expect(result.rejections.map((r) => r.reason)).toEqual(["unknown_field"]);
  });

  it("rejects markup in a known field", () => {
    const result = checkAnswers({ name: "<script>x</script>" }, allowed);
    expect(result.rejections[0]?.reason).toBe("markup_not_allowed");
  });

  it("rejects a submission with too many fields, before per-field checks", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 101; i++) many[`f${i}`] = "x";
    const result = checkAnswers(many, allowed);
    expect(result.rejections).toEqual([{ field: "answers", reason: "too_many_fields" }]);
    expect(result.answers).toEqual({});
  });

  it("accepts an empty answer map", () => {
    expect(checkAnswers({}, allowed)).toEqual({ rejections: [], answers: {} });
  });
});

describe("checkUtm", () => {
  it("captures all five parameters", () => {
    const result = checkUtm({
      source: "google",
      medium: "cpc",
      campaign: "monsoon",
      term: "erp",
      content: "banner-a",
    });
    expect(result.rejections).toEqual([]);
    expect(result.utm).toEqual({
      source: "google",
      medium: "cpc",
      campaign: "monsoon",
      term: "erp",
      content: "banner-a",
    });
  });

  it("ignores absent and empty values", () => {
    expect(checkUtm({ source: "", medium: undefined, campaign: null }).utm).toEqual({});
  });

  it("REJECTS an oversized UTM value rather than truncating it", () => {
    const result = checkUtm({ campaign: "x".repeat(MAX_UTM_LENGTH + 1) });
    expect(result.rejections[0]).toMatchObject({ field: "utm.campaign", reason: "too_long" });
    expect(result.utm.campaign).toBeUndefined();
  });

  it("accepts a UTM value exactly at the bound", () => {
    expect(checkUtm({ campaign: "x".repeat(MAX_UTM_LENGTH) }).rejections).toEqual([]);
  });

  it("rejects markup in a UTM value", () => {
    expect(checkUtm({ source: "<svg onload=1>" }).rejections[0]?.reason).toBe("markup_not_allowed");
  });

  it("trims and stringifies values", () => {
    expect(checkUtm({ source: "  google  ", term: 2026 }).utm).toEqual({ source: "google", term: "2026" });
  });

  it("ignores keys that are not UTM parameters", () => {
    expect(checkUtm({ evil: "x" }).utm).toEqual({});
  });
});

describe("utmFromUrl", () => {
  it("parses UTM parameters from a landing URL", () => {
    const utm = utmFromUrl("https://example.gov.in/land?utm_source=google&utm_campaign=monsoon");
    expect(utm).toEqual({ source: "google", campaign: "monsoon" });
  });

  it("returns nothing for an unparseable URL instead of throwing", () => {
    expect(utmFromUrl("not a url")).toEqual({});
  });

  it("returns nothing when there are no UTM parameters", () => {
    expect(utmFromUrl("https://example.gov.in/land")).toEqual({});
  });

  it("drops an oversized parameter", () => {
    const long = "x".repeat(MAX_UTM_LENGTH + 1);
    expect(utmFromUrl(`https://e.in/?utm_source=${long}`)).toEqual({});
  });

  it("drops a parameter containing markup", () => {
    expect(utmFromUrl("https://e.in/?utm_source=%3Cscript%3E")).toEqual({});
  });
});

describe("publicSafeRejectionSummary", () => {
  it("names a server-declared field", () => {
    const summary = publicSafeRejectionSummary([{ field: "budget", reason: "too_long" }], ["budget"]);
    expect(summary.reasons[0]).toContain("budget");
    expect(summary.rejectedCount).toBe(1);
  });

  it("does NOT echo a field name that came from the request", () => {
    const attackerKey = "<img src=x onerror=alert(1)>";
    const summary = publicSafeRejectionSummary([{ field: attackerKey, reason: "unknown_field" }], ["budget"]);
    expect(summary.reasons.join(" ")).not.toContain("onerror");
    expect(summary.reasons[0]).toContain("unknown_field");
  });

  it("names UTM and answer-level rejections, which are server-defined labels", () => {
    const summary = publicSafeRejectionSummary(
      [
        { field: "utm.campaign", reason: "too_long" },
        { field: "answers", reason: "too_many_fields" },
      ],
      [],
    );
    expect(summary.reasons.some((r) => r.includes("utm.campaign"))).toBe(true);
    expect(summary.rejectedCount).toBe(2);
  });

  it("dedupes identical reasons", () => {
    const summary = publicSafeRejectionSummary(
      [
        { field: "a", reason: "unknown_field" },
        { field: "b", reason: "unknown_field" },
      ],
      [],
    );
    expect(summary.reasons).toHaveLength(1);
    expect(summary.rejectedCount).toBe(2);
  });
});

describe("FixedWindowRateLimiter", () => {
  it("allows up to max and then denies", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({ max: 3, windowMs: 60_000, now: () => now });
    expect(limiter.hit("k").allowed).toBe(true);
    expect(limiter.hit("k").allowed).toBe(true);
    const third = limiter.hit("k");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = limiter.hit("k");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBe(60);
  });

  it("resets after the window elapses", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({ max: 1, windowMs: 1_000, now: () => now });
    expect(limiter.hit("k").allowed).toBe(true);
    expect(limiter.hit("k").allowed).toBe(false);
    now = 1_001;
    expect(limiter.hit("k").allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
    expect(limiter.size()).toBe(2);
  });

  it("sweeps expired buckets", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({ max: 5, windowMs: 100, now: () => now });
    limiter.hit("a");
    limiter.hit("b");
    now = 200;
    expect(limiter.sweep()).toBe(2);
    expect(limiter.size()).toBe(0);
  });

  it("does not sweep a live bucket", () => {
    const limiter = new FixedWindowRateLimiter({ max: 5, windowMs: 1_000, now: () => 0 });
    limiter.hit("a");
    expect(limiter.sweep()).toBe(0);
    expect(limiter.size()).toBe(1);
  });

  it("fails CLOSED when the key cap is reached and nothing can be swept", () => {
    const limiter = new FixedWindowRateLimiter({ max: 10, windowMs: 60_000, maxKeys: 2, now: () => 0 });
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
    // Third distinct key: cap reached, both buckets still live → denied.
    expect(limiter.hit("c").allowed).toBe(false);
    // An existing key is still served, so a flood of new keys cannot lock out
    // callers already inside their window.
    expect(limiter.hit("a").allowed).toBe(true);
  });

  it("admits a new key once the cap frees up via sweeping", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({ max: 10, windowMs: 100, maxKeys: 2, now: () => now });
    limiter.hit("a");
    limiter.hit("b");
    now = 500;
    expect(limiter.hit("c").allowed).toBe(true);
  });

  it("reset() discards all state", () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
    limiter.hit("a");
    limiter.reset();
    expect(limiter.size()).toBe(0);
    expect(limiter.hit("a").allowed).toBe(true);
  });
});

describe("PII encryption (encryptedText backing functions)", () => {
  it("round-trips a value", () => {
    const cipher = encryptPii("Rakesh Sharma");
    expect(isEncrypted(cipher)).toBe(true);
    expect(cipher).not.toContain("Rakesh");
    expect(decryptPii(cipher)).toBe("Rakesh Sharma");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptPii("same")).not.toBe(encryptPii("same"));
  });

  it("passes through a value that is not in the envelope format", () => {
    expect(decryptPii("legacy plaintext")).toBe("legacy plaintext");
    expect(isEncrypted("legacy plaintext")).toBe(false);
  });

  it("fails closed on a tampered envelope", () => {
    const cipher = encryptPii("secret");
    const tampered = `${cipher.slice(0, -4)}AAAA`;
    expect(() => decryptPii(tampered)).toThrow(PiiDecryptError);
  });

  it("fails closed on a malformed envelope with no key id", () => {
    expect(() => decryptPii("enc:v2:nokeyid")).toThrow(PiiDecryptError);
  });

  it("fails closed when the key id is not in the keyring", () => {
    expect(() => decryptPii("enc:v2:unknownkey:AAAA")).toThrow(/no PII key for key id/);
  });

  it("throws a clear error when the key is missing entirely", () => {
    const original = process.env.METADATA_PII_KEY;
    resetPiiKeyCache();
    delete process.env.METADATA_PII_KEY;
    expect(() => encryptPii("x")).toThrow(/METADATA_PII_KEY is required/);
    if (original !== undefined) process.env.METADATA_PII_KEY = original;
    resetPiiKeyCache();
    // Sanity: the keyring recovers once the key is restored.
    expect(decryptPii(encryptPii("y"))).toBe("y");
  });
});

describe("PII masking for list reads", () => {
  it("masks an email to first char + domain", () => {
    expect(maskEmail("asha@example.gov.in")).toBe("a***@example.gov.in");
  });

  it("masks a value with no @ generically", () => {
    expect(maskEmail("notanemail")).toBe("n***");
  });

  it("masks a very short value", () => {
    expect(maskEmail("ab")).toBe("**");
  });

  it("passes through null", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });

  it("keeps the last four digits of a phone number", () => {
    expect(maskPhone("9876543210")).toBe("******3210");
  });

  it("masks a very short phone number entirely", () => {
    expect(maskPhone("321")).toBe("****");
  });
});
