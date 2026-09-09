// PERF-010 -- finance/hrms reads tier-1 k6 sanity check (one script covering
// both named targets, per the gap's own grouping: "finance/hrms reads").
//
// Targets:
//   GET /v1/finance/accounts   (services/finance-service/src/modules/budget/routes.ts)
//   GET /v1/hrms/employees     (services/hrms-service/src/modules/employee/routes.ts)
// Both are real, DB-backed list reads behind resolveContext()+requireRole()
// (READER_ROLES includes super_admin on both), run against a real Postgres
// database (civitas_finance / civitas_hrms) -- not mocked.
//
// REAL LIMIT DISCOVERED WHILE BUILDING THIS TEST: both services enforce a
// per-tenant API quota via packages/rate-limit (finance: max 200/min,
// services/finance-service/src/app.ts; hrms: max 300/min,
// services/hrms-service/src/app.ts), keyed by tenant/actor -- NOT
// IP-allowlisted the way the code comment in packages/rate-limit/src/index.ts
// suggests it should be for 127.0.0.1 (that allowList appears not to match
// in practice here, likely an IPv4-mapped-IPv6 req.ip formatting mismatch --
// flagged as a separate follow-up, not fixed in this PR). Confirmed
// empirically: a free-running 10-VU test produced 92%+ http_req_failed, all
// real 429 "QUOTA_EXCEEDED"/"TOO_MANY_REQUESTS" responses from the
// application layer, not a k6 or network problem. Since every VU here
// shares one test tenant/actor (by design -- see mint-perf-token.cjs), the
// quota is shared across the whole run regardless of VU count, so this test
// paces itself under both ceilings with constant-arrival-rate.
//
// CAVEAT: the seed/fixture data volume on this dev host is whatever this
// worktree's isolated Postgres happens to hold (likely near-empty for a
// fresh bootstrap) -- these numbers measure real query + serialization
// latency on THIS DATA VOLUME, not at the row counts the production SLO
// (p95 read < 400ms / < 500ms) assumes. Treat this as "the code path works
// and has a real, repeatable baseline," not as row-count-representative.
//
// THRESHOLDS BELOW ARE DEV-SCALE SANITY NUMBERS, not the documented SLO.
import http from "k6/http";
import { check, group } from "k6";

export const options = {
  scenarios: {
    finance_hrms_reads: {
      executor: "constant-arrival-rate",
      // Each iteration issues one finance + one hrms request, so 2/s here
      // means 120 req/min to EACH endpoint -- comfortably under finance's
      // 200/min and hrms's 300/min real per-tenant quotas.
      rate: Number(__ENV.PERF_RATE || 2),
      timeUnit: "1s",
      duration: __ENV.PERF_DURATION || "30s",
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:finance_accounts_read}": ["p(95)<250", "p(99)<500"],
    "http_req_duration{name:hrms_employees_read}": ["p(95)<250", "p(99)<500"],
  },
};

const FINANCE_URL = __ENV.FINANCE_URL || "http://127.0.0.1:3007";
const HRMS_URL = __ENV.HRMS_URL || "http://127.0.0.1:3012";
const TOKEN = __ENV.PERF_JWT;
if (!TOKEN) {
  throw new Error("PERF_JWT env var is required (mint with scripts/perf/mint-perf-token.cjs)");
}

const authHeaders = { headers: { Authorization: `Bearer ${TOKEN}` } };

export default function () {
  group("finance accounts read", function () {
    const res = http.get(`${FINANCE_URL}/v1/finance/accounts?limit=20`, {
      ...authHeaders,
      tags: { name: "finance_accounts_read" },
    });
    check(res, { "finance status is 200": (r) => r.status === 200 });
  });

  group("hrms employees read", function () {
    const res = http.get(`${HRMS_URL}/v1/hrms/employees?limit=20`, {
      ...authHeaders,
      tags: { name: "hrms_employees_read" },
    });
    check(res, { "hrms status is 200": (r) => r.status === 200 });
  });
}
