// PERF-010: mints an HS256 dev/test JWT for the k6 perf suite to authenticate
// against identity/finance/hrms while they're started outside PM2 (per
// scripts/start-k6-stack.sh's pattern, not ecosystem.config.js).
//
// Deliberately NOT reusing scripts/dev/_mint-dev-token.cjs: that helper omits
// the `aud` claim, and packages/auth/src/index.ts's verifyToken() validates
// audience unconditionally on the HS256 path (`HS256_TOKEN_AUDIENCE ??
// "civitasone"`) -- a token minted without `aud` fails verification with
// "jwt audience invalid" against the CURRENT auth package. That looks like a
// live, separate bug in _mint-dev-token.cjs (flagged out-of-scope for
// PERF-010, not fixed here); this script sets iss/aud explicitly so the k6
// suite doesn't depend on it either way.
const { createHmac } = require("node:crypto");

const SECRET = process.env.JWT_SECRET || "civitasone-dev-secret";
const ISSUER = process.env.HS256_TOKEN_ISSUER || "civitasone-dev";
const AUDIENCE = process.env.HS256_TOKEN_AUDIENCE || "civitasone";
const TENANT = process.env.PERF_TENANT_ID || "00000000-0000-4000-8000-000000000001";
const ACTOR = process.env.PERF_ACTOR_ID || "00000000-0000-4000-8000-0000000000aa";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = b64({ alg: "HS256", typ: "JWT" });
const payload = b64({
  sub: ACTOR,
  iss: ISSUER,
  aud: AUDIENCE,
  tid: TENANT,
  tenantId: TENANT,
  sid: "perf010-k6-session",
  roles: ["super_admin"],
  iat: now,
  exp: now + 3600 * 4,
});
const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${sig}`);
