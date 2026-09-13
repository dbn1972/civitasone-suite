import { describe, it, expect } from "vitest";
import { decodeUnverifiedClaims, signToken } from "../src/index.js";

// SEC-015: decodeUnverifiedClaims is what apps/web's OAuth callback route
// uses to read sub/tid/sid off a token it just obtained directly from
// Keycloak's token endpoint, purely to populate the body of the subsequent
// POST /identity/sessions call. It deliberately does NOT verify the
// signature -- that's the whole point (see its doc-comment) -- so this file
// only proves the decode shape/contract, not any authorization behaviour.
const SECRET = "test_secret_for_civitasone_32chr";

describe("decodeUnverifiedClaims (SEC-015)", () => {
  it("reads sub/tid/sid off a validly-shaped token without needing the signing secret", () => {
    const token = signToken(
      { sub: "u-1", tid: "t-1", roles: ["employee"], sid: "s-1" } as never,
      SECRET,
    );
    const claims = decodeUnverifiedClaims(token);
    expect(claims?.sub).toBe("u-1");
    expect(claims?.tid).toBe("t-1");
    expect(claims?.sid).toBe("s-1");
  });

  it("does not throw or require a valid signature -- a token signed with a DIFFERENT secret still decodes", () => {
    // Proves this really is unverified: a real verify (verifyJwt/verifyToken)
    // would reject this outright.
    const token = signToken({ sub: "u-2", tid: "t-2", roles: [], sid: "s-2" } as never, "a-totally-different-secret-32chars");
    const claims = decodeUnverifiedClaims(token);
    expect(claims?.sub).toBe("u-2");
  });

  it("returns null for a structurally invalid token instead of throwing", () => {
    expect(decodeUnverifiedClaims("not-a-jwt-at-all")).toBeNull();
    expect(decodeUnverifiedClaims("")).toBeNull();
  });

  it("returns null (not partial data) for a token missing entirely -- three-dot garbage", () => {
    expect(decodeUnverifiedClaims("a.b.c")).toBeNull();
  });
});
