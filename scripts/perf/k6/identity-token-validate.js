// PERF-010 -- identity token-validate tier-0 k6 sanity check.
//
// SCOPE: the SLO table (docs/operations/SLO-SLI-RUNBOOKS.md) names "token
// validate < 150ms" as identity-service's key SLI, but identity-service
// exposes no standalone "validate this token" HTTP route -- most token
// verification in this fleet happens locally, per-request, inside each
// service via packages/auth (JWKS/HS256), never as a network call to
// identity-service. The closest REAL, working equivalent that (a) is an
// actual identity-service HTTP endpoint and (b) does credential validation
// against the database is POST /identity/api-keys/verify (see
// services/identity-service/src/modules/apikeys/routes.ts +
// modules/apikeys/commands.ts#verifyApiKey): it runs the caller's bearer
// JWT through the exact same verifyToken() HS256/RS256 path every other
// authenticated route uses (resolveContext -> resolveServiceContext ->
// verifyToken), THEN does a real sha256-hash + DB lookup to validate a
// second, API-key-shaped credential. So every request below pays for two
// real "is this credential valid" checks, not zero.
//
// The presented key is a random, deliberately-unregistered value -- the
// route's real work (hash + indexed lookup + miss) still executes and is
// timed; only the semantic answer is a 200 { valid:false, reason:"unknown
// key" }, which is asserted below as the expected response for k6's own
// sanity, not as evidence of "always finds nothing" being fine to load-test.
//
// THRESHOLDS BELOW ARE DEV-SCALE SANITY NUMBERS, not the documented SLO.
// 150ms is the production target; this dev host runs identity-service as a
// single unclustered process against a single local Postgres container with
// no PgBouncer/connection-pool tuning for scale, so the number here is
// intentionally looser and is a regression baseline for THIS environment.
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    identity_token_validate: {
      executor: "constant-vus",
      vus: Number(__ENV.PERF_VUS || 10),
      duration: __ENV.PERF_DURATION || "20s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:identity_verify}": ["p(95)<200", "p(99)<400"],
  },
};

const BASE_URL = __ENV.IDENTITY_URL || "http://127.0.0.1:3001";
const TOKEN = __ENV.PERF_JWT;
if (!TOKEN) {
  throw new Error("PERF_JWT env var is required (mint with scripts/perf/mint-perf-token.cjs)");
}

export default function () {
  const key = `loadtest-k6-${__VU}-${__ITER}-${Math.random().toString(36).slice(2)}`.padEnd(24, "x");
  const res = http.post(
    `${BASE_URL}/identity/api-keys/verify`,
    JSON.stringify({ key }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      tags: { name: "identity_verify" },
    },
  );
  check(res, {
    "status is 200": (r) => r.status === 200,
    "body has valid:false for unknown key": (r) => {
      try {
        return JSON.parse(r.body).valid === false;
      } catch {
        return false;
      }
    },
  });
  sleep(0.05);
}
