/** CAP-038 — comments pure domain: visibility filter + thread assembly. */
import { describe, it, expect } from "vitest";
import { visibleTo, buildThreads, validateBody } from "../src/modules/comments/domain.js";

type C = { id: string; parentCommentId: string | null; visibility: string };

describe("visibleTo", () => {
  const comments: C[] = [
    { id: "1", parentCommentId: null, visibility: "internal" },
    { id: "2", parentCommentId: null, visibility: "external" },
  ];
  it("internal viewers see everything", () => {
    expect(visibleTo(comments, "internal")).toHaveLength(2);
  });
  it("external viewers see only external", () => {
    const v = visibleTo(comments, "external");
    expect(v).toHaveLength(1);
    expect(v[0]!.id).toBe("2");
  });
});

describe("buildThreads", () => {
  it("nests replies under parents", () => {
    const flat: C[] = [
      { id: "1", parentCommentId: null, visibility: "internal" },
      { id: "2", parentCommentId: "1", visibility: "internal" },
      { id: "3", parentCommentId: "1", visibility: "internal" },
    ];
    const roots = buildThreads(flat);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.replies.map((r) => r.comment.id)).toEqual(["2", "3"]);
  });
  it("promotes orphan replies (parent filtered out) to top level", () => {
    const flat: C[] = [{ id: "2", parentCommentId: "1", visibility: "external" }];
    const roots = buildThreads(flat);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.comment.id).toBe("2");
  });
});

describe("validateBody", () => {
  it("rejects empty", () => {
    expect(validateBody("   ").errors).toContain("BODY_REQUIRED");
    expect(validateBody("hi").allowed).toBe(true);
  });
});
