/**
 * WC-010 — unit tests for the configuration-as-artefact domain logic.
 *
 * Pure functions only: canonicalisation + checksum, the leaf-path diff
 * algorithm, and the promotion/rollback guards. No DB, no Fastify.
 */
import { describe, it, expect } from "vitest";
import { HttpError } from "../src/shared/context.js";
import {
  ENVIRONMENTS,
  PROMOTION_KINDS,
  PROMOTION_STATUSES,
  canonicalJson,
  checksumOf,
  flattenEntries,
  valuesEqual,
  diffConfig,
  nextArtefactVersion,
  assertApproverDistinct,
  assertPendingPromotion,
  assertVersionMatch,
  assertRollbackTargetPreviouslyPromoted,
  assertRollbackIsBackwards,
} from "../src/modules/config/artefact-domain.js";

/** Assert a thrower produces an HttpError with the given status + code. */
function expectHttpError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    const e = err as HttpError;
    expect(e.status).toBe(status);
    expect(e.code).toBe(code);
    return;
  }
  throw new Error(`expected an HttpError ${status} ${code}, nothing was thrown`);
}

describe("WC-010 constants", () => {
  it("exposes the four promotable environments in promotion order", () => {
    expect(ENVIRONMENTS).toEqual(["dev", "staging", "uat", "production"]);
  });
  it("exposes the promotion kinds and statuses used by the CHECK constraints", () => {
    expect(PROMOTION_KINDS).toEqual(["promote", "rollback"]);
    expect(PROMOTION_STATUSES).toEqual(["pending", "promoted", "rejected"]);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every depth so insertion order cannot change the form", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order, because order is meaningful in a config list", () => {
    expect(canonicalJson([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalJson([3, 2, 1])).toBe("[3,2,1]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("handles scalars, null and undefined without producing the string 'undefined'", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(true)).toBe("true");
  });

  it("canonicalises objects nested inside arrays", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("escapes keys as JSON strings", () => {
    expect(canonicalJson({ 'a"b': 1 })).toBe('{"a\\"b":1}');
  });
});

describe("checksumOf", () => {
  it("is a 64-char lowercase sha-256 hex digest", () => {
    expect(checksumOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is identical for logically equal sets written in a different key order", () => {
    expect(checksumOf({ a: 1, b: 2 })).toBe(checksumOf({ b: 2, a: 1 }));
  });

  it("differs when any value differs", () => {
    expect(checksumOf({ a: 1 })).not.toBe(checksumOf({ a: 2 }));
  });

  it("differs for reordered arrays", () => {
    expect(checksumOf({ a: [1, 2] })).not.toBe(checksumOf({ a: [2, 1] }));
  });

  it("gives the empty set a stable digest", () => {
    expect(checksumOf({})).toBe(checksumOf({}));
  });
});

describe("flattenEntries", () => {
  it("flattens nested plain objects to dot paths", () => {
    const flat = flattenEntries({ db: { host: "h", port: 5432 }, debug: false });
    expect([...flat.keys()].sort()).toEqual(["db.host", "db.port", "debug"]);
    expect(flat.get("db.port")).toBe(5432);
  });

  it("treats an array as a LEAF, not as indexed sub-paths", () => {
    const flat = flattenEntries({ allowedOrigins: ["a", "b"] });
    expect([...flat.keys()]).toEqual(["allowedOrigins"]);
    expect(flat.get("allowedOrigins")).toEqual(["a", "b"]);
  });

  it("treats an EMPTY object as a leaf so {} -> {a:1} still shows a change", () => {
    const flat = flattenEntries({ section: {} });
    expect([...flat.keys()]).toEqual(["section"]);
    expect(flat.get("section")).toEqual({});
  });

  it("treats null as a leaf value rather than descending into it", () => {
    const flat = flattenEntries({ a: null });
    expect([...flat.keys()]).toEqual(["a"]);
    expect(flat.get("a")).toBeNull();
  });

  it("flattens three levels deep", () => {
    const flat = flattenEntries({ a: { b: { c: 1 } } });
    expect([...flat.keys()]).toEqual(["a.b.c"]);
  });

  it("honours an explicit prefix", () => {
    const flat = flattenEntries({ a: 1 }, "root");
    expect([...flat.keys()]).toEqual(["root.a"]);
  });

  it("returns an empty map for an empty set", () => {
    expect(flattenEntries({}).size).toBe(0);
  });
});

describe("valuesEqual", () => {
  it("compares by canonical form so object key order does not matter", () => {
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it("is order-sensitive for arrays", () => {
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
  });
  it("does not treat 1 and '1' as equal", () => {
    expect(valuesEqual(1, "1")).toBe(false);
  });
  it("treats null and undefined as equal, both canonicalising to null", () => {
    expect(valuesEqual(null, undefined)).toBe(true);
  });
});

describe("diffConfig", () => {
  it("reports no change for identical sets and marks them identical", () => {
    const diff = diffConfig({ a: 1, b: "x" }, { a: 1, b: "x" });
    expect(diff.identical).toBe(true);
    expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 2 });
    expect(diff.unchanged.map((u) => u.path)).toEqual(["a", "b"]);
  });

  it("is identical for the same set written in a different key order", () => {
    expect(diffConfig({ a: 1, b: 2 }, { b: 2, a: 1 }).identical).toBe(true);
  });

  it("reports added keys with their new value", () => {
    const diff = diffConfig({ a: 1 }, { a: 1, b: 2 });
    expect(diff.added).toEqual([{ path: "b", to: 2 }]);
    expect(diff.identical).toBe(false);
    expect(diff.summary.added).toBe(1);
  });

  it("reports removed keys with their old value", () => {
    const diff = diffConfig({ a: 1, b: 2 }, { a: 1 });
    expect(diff.removed).toEqual([{ path: "b", from: 2 }]);
    expect(diff.summary.removed).toBe(1);
  });

  it("reports changed keys with both sides", () => {
    const diff = diffConfig({ a: 1 }, { a: 2 });
    expect(diff.changed).toEqual([{ path: "a", from: 1, to: 2 }]);
    expect(diff.summary.changed).toBe(1);
  });

  it("diffs nested objects at leaf granularity", () => {
    const diff = diffConfig(
      { db: { host: "old", port: 5432 } },
      { db: { host: "new", port: 5432 } },
    );
    expect(diff.changed).toEqual([{ path: "db.host", from: "old", to: "new" }]);
    expect(diff.unchanged).toEqual([{ path: "db.port", value: 5432 }]);
  });

  it("reports a whole nested subtree as added when the parent key is new", () => {
    const diff = diffConfig({}, { db: { host: "h", port: 1 } });
    expect(diff.added.map((a) => a.path)).toEqual(["db.host", "db.port"]);
  });

  it("handles a leaf becoming an object: the old leaf is removed, new leaves added", () => {
    const diff = diffConfig({ a: 2 }, { a: { b: 1 } });
    expect(diff.removed).toEqual([{ path: "a", from: 2 }]);
    expect(diff.added).toEqual([{ path: "a.b", to: 1 }]);
    expect(diff.changed).toEqual([]);
  });

  it("handles an object becoming a leaf", () => {
    const diff = diffConfig({ a: { b: 1 } }, { a: 2 });
    expect(diff.removed).toEqual([{ path: "a.b", from: 1 }]);
    expect(diff.added).toEqual([{ path: "a", to: 2 }]);
  });

  it("reports an array value change as one change at the array's own path", () => {
    const diff = diffConfig({ origins: ["a"] }, { origins: ["a", "b"] });
    expect(diff.changed).toEqual([{ path: "origins", from: ["a"], to: ["a", "b"] }]);
  });

  it("treats an array reorder as a change", () => {
    expect(diffConfig({ o: [1, 2] }, { o: [2, 1] }).changed).toHaveLength(1);
  });

  it("does not report a change when a nested object is merely reordered", () => {
    const diff = diffConfig({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } });
    expect(diff.identical).toBe(true);
  });

  it("detects a null -> value transition as a change", () => {
    expect(diffConfig({ a: null }, { a: 1 }).changed).toEqual([{ path: "a", from: null, to: 1 }]);
  });

  it("detects false -> 0 as a change (no loose equality)", () => {
    expect(diffConfig({ a: false }, { a: 0 }).changed).toHaveLength(1);
  });

  it("sorts every output array by path for a stable, reviewable diff", () => {
    const diff = diffConfig({ z: 1, m: 1 }, { a: 1, b: 1, m: 2 });
    expect(diff.added.map((r) => r.path)).toEqual(["a", "b"]);
    expect(diff.removed.map((r) => r.path)).toEqual(["z"]);
    expect(diff.changed.map((r) => r.path)).toEqual(["m"]);
  });

  it("reports two empty sets as identical", () => {
    const diff = diffConfig({}, {});
    expect(diff.identical).toBe(true);
    expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 0 });
  });

  it("counts added, removed and changed together in one diff", () => {
    const diff = diffConfig({ keep: 1, drop: 2, edit: 3 }, { keep: 1, edit: 4, add: 5 });
    expect(diff.summary).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(diff.identical).toBe(false);
  });
});

describe("nextArtefactVersion", () => {
  it("starts at 1 for a set that has never been snapshotted", () => {
    expect(nextArtefactVersion(null)).toBe(1);
    expect(nextArtefactVersion(undefined)).toBe(1);
  });
  it("increments monotonically", () => {
    expect(nextArtefactVersion(1)).toBe(2);
    expect(nextArtefactVersion(41)).toBe(42);
  });
});

describe("promotion guards", () => {
  const MAKER = "11111111-1111-4000-8000-000000000001";
  const CHECKER = "22222222-2222-4000-8000-000000000002";

  it("allows a distinct approver", () => {
    expect(() => assertApproverDistinct(MAKER, CHECKER)).not.toThrow();
  });

  it("blocks self-approval with 409 MAKER_CHECKER_VIOLATION", () => {
    expectHttpError(() => assertApproverDistinct(MAKER, MAKER), 409, "MAKER_CHECKER_VIOLATION");
  });

  it("allows deciding a pending promotion", () => {
    expect(() => assertPendingPromotion("pending")).not.toThrow();
  });

  it("blocks re-deciding a promoted or rejected promotion with 409 NOT_PENDING", () => {
    expectHttpError(() => assertPendingPromotion("promoted"), 409, "NOT_PENDING");
    expectHttpError(() => assertPendingPromotion("rejected"), 409, "NOT_PENDING");
  });

  it("treats an absent expectedVersion as 'no opinion' and does not throw", () => {
    expect(() => assertVersionMatch(7, undefined)).not.toThrow();
  });

  it("passes when the expected version matches", () => {
    expect(() => assertVersionMatch(3, 3)).not.toThrow();
  });

  it("returns 409 VERSION_CONFLICT on a stale version", () => {
    expectHttpError(() => assertVersionMatch(4, 3), 409, "VERSION_CONFLICT");
  });

  it("includes both versions in the conflict message so a client can re-read", () => {
    try {
      assertVersionMatch(9, 2);
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as HttpError).message).toContain("expected 2");
      expect((err as HttpError).message).toContain("current is 9");
    }
  });
});

describe("rollback guards", () => {
  it("permits rolling back to a version previously promoted to that environment", () => {
    expect(() => assertRollbackTargetPreviouslyPromoted([1, 2, 3], 2)).not.toThrow();
  });

  it("refuses a target that was never promoted there (422)", () => {
    expectHttpError(
      () => assertRollbackTargetPreviouslyPromoted([1, 3], 2),
      422,
      "ROLLBACK_TARGET_NOT_PROMOTED",
    );
  });

  it("refuses any target when nothing was ever promoted there", () => {
    expectHttpError(
      () => assertRollbackTargetPreviouslyPromoted([], 1),
      422,
      "ROLLBACK_TARGET_NOT_PROMOTED",
    );
  });

  it("permits a strictly backwards move", () => {
    expect(() => assertRollbackIsBackwards(5, 4)).not.toThrow();
  });

  it("refuses a sideways move to the live version (422 NOT_A_ROLLBACK)", () => {
    expectHttpError(() => assertRollbackIsBackwards(5, 5), 422, "NOT_A_ROLLBACK");
  });

  it("refuses a forwards move dressed up as a rollback", () => {
    expectHttpError(() => assertRollbackIsBackwards(5, 6), 422, "NOT_A_ROLLBACK");
  });
});
