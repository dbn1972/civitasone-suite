/**
 * L7 — SLO measurement run. Emits a machine-readable summary the release gate
 * consumes as its error-budget input.
 *
 * Distinct from k6-baseline.js: that script targets 1,000 TPS to prove capacity.
 * This one runs a modest, dev-box-safe rate whose purpose is to MEASURE the SLOs
 * and write an artifact, so "RELEASABLE" can mean more than "unit lanes passed".
 *
 * SLOs asserted (from steering: 1,000 TPS, sub-200ms p95 reads):
 *   - read p95   < 500ms   (dev threshold; production target 200ms)
 *   - error rate < 1%      (5xx only; 401/403/429 are correct answers, not errors)
 *
 * Run:
 *   GATEWAY_URL=http://localhost:8080 CIVITAS_TOKEN=<hs256-jwt> \
 *     k6 run --summary-export=evidence/<date>/L7-k6-slo.json tests/load/k6-slo.js
 *
 * Honesty notes:
 *   - A run that never reaches the service must NOT read clean. `reachable_reads`
 *     is a counter with a threshold, so zero successful reads fails the run.
 *   - 5xx is the only error class counted toward the budget. Treating 401/429 as
 *     failures would make the gate fire on correct auth/rate-limit behaviour.
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const GATEWAY = __ENV.GATEWAY_URL || "http://localhost:8080";

/**
 * Tokens are rotated per-iteration across DISTINCT actors.
 *
 * Why this matters: the gateway rate-limits ~100 req/min PER USER. Driving 50
 * req/s through a single token means most responses are 429, so the run measures
 * the rate limiter instead of the read path — a verified failure mode (an earlier
 * run reported only 1000 of 1500 reads as measurable, the rest 429).
 *
 * CIVITAS_TOKENS: comma-separated JWTs for distinct actors (preferred).
 * CIVITAS_TOKEN:  single token (kept for compatibility; will hit the limiter).
 */
const TOKENS = (__ENV.CIVITAS_TOKENS || __ENV.CIVITAS_TOKEN || "")
  .split(",")
  .map((t) => t.trim())
  .filter((t) => t.length > 0);

// Reads that must exist for the run to be meaningful.
const READ_PATHS = [
  "/api/v1/finance/bills",
  "/api/v1/finance/sanctions",
  "/api/v1/hrms/employees",
  "/api/v1/procurement/vendors",
];

export const serverErrors = new Counter("server_errors");
export const reachableReads = new Counter("reachable_reads");
export const readLatency = new Trend("read_latency", true);
export const serverErrorRate = new Rate("server_error_rate");
/** Share of responses that were rate-limited — makes limiter interference visible. */
export const rateLimitedRate = new Rate("rate_limited_rate");

/**
 * Arrival rate is deliberately BELOW the gateway's global limiter.
 *
 * MEASURED: gateway-service registers a global rate limit of 1000 req/min using
 * fastify's DEFAULT keyGenerator, which keys on req.ip — not on user. A 30s run
 * at 50 req/s produced exactly 1000 successes then 501 × 429, and raising the
 * actor count from 1 to 40 changed nothing (33.33% -> 33.37% limited), which is
 * what proved the key is the IP.
 *
 * 1000 req/min = 16.6 req/s, so 12 req/s leaves headroom for the surrounding
 * suite to share the same bucket. Capacity at 1,000 TPS is a separate concern
 * proven by k6-baseline.js against a properly distributed load generator.
 */
const ARRIVAL_RATE = Number(__ENV.SLO_ARRIVAL_RATE || 12);

export const options = {
  scenarios: {
    slo_reads: {
      executor: "constant-arrival-rate",
      rate: ARRIVAL_RATE,
      timeUnit: "1s",
      duration: __ENV.SLO_DURATION || "30s",
      preAllocatedVUs: 10,
      maxVUs: 40,
    },
  },
  thresholds: {
    // Error budget: <1% 5xx. WARN band per steering is >1%.
    server_error_rate: ["rate<0.01"],
    // Read latency SLO (dev threshold).
    read_latency: ["p(95)<500"],
    // Anti-vacuous-pass guard: a run with no successful reads FAILS rather than
    // reporting an empty-but-clean result. Floor is ~70% of planned requests.
    reachable_reads: [`count>${Math.floor(ARRIVAL_RATE * 30 * 0.7)}`],
    // If most traffic is rate-limited, the latency figure describes the limiter,
    // not the read path. Fail so the result is not mistaken for an SLO measurement.
    rate_limited_rate: ["rate<0.20"],
  },
  // Keep the run honest about its own shape in the exported summary.
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  const path = READ_PATHS[Math.floor(Math.random() * READ_PATHS.length)];
  // Spread across actors so the per-user limiter is not what we measure.
  const token = TOKENS.length > 0
    ? TOKENS[(__VU + __ITER) % TOKENS.length]
    : "";
  const params = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    tags: { path },
  };

  const res = http.get(`${GATEWAY}${path}`, params);

  const is5xx = res.status >= 500;
  serverErrorRate.add(is5xx);
  if (is5xx) serverErrors.add(1);
  rateLimitedRate.add(res.status === 429);

  // Only a genuine 200 counts as a measured read.
  if (res.status === 200) {
    reachableReads.add(1);
    readLatency.add(res.timings.duration);
  }

  check(res, {
    "no server error": () => !is5xx,
  });
}
