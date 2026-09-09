// PERF-010 -- gateway (basic request path) tier-0 k6 sanity check.
//
// SCOPE: hits gateway-service's /health liveness route (see
// services/gateway-service/src/app.ts: "/health (liveness) -- always 200;
// handled by registerOpsRoutes; never probes upstreams"), NOT a full
// authenticated proxy round-trip through an upstream service. It measures
// the gateway process's own baseline request-handling overhead -- the same
// "edge" cost the SLO table's "p95 proxy < 50ms overhead" targets
// conceptually, not a validation of full end-to-end proxy latency.
//
// REAL LIMIT DISCOVERED WHILE BUILDING THIS TEST: gateway-service registers
// a GLOBAL @fastify/rate-limit of max 1000 req/min per client IP (see
// services/gateway-service/src/app.ts line ~350-354,
// GATEWAY_RATE_LIMIT_MAX). A naive constant-VUs k6 run from a single source
// IP blows through that budget in a few seconds and then measures 429s, not
// real health-check latency (confirmed empirically: 10 VUs free-running
// produced 73%+ http_req_failed, all 429 "Rate limit exceeded"). This test
// deliberately paces itself under that ceiling with constant-arrival-rate so
// it measures the real, intended latency instead of tripping the platform's
// own (working-as-designed) abuse protection.
//
// THRESHOLDS BELOW ARE DEV-SCALE SANITY NUMBERS, not the production SLO
// (docs/operations/SLO-SLI-RUNBOOKS.md: 1,000 TPS / 10M users). They were
// chosen to be achievable against a single gateway-service process on a
// shared, unoptimized EC2 dev host -- they prove the request path works and
// give a real, repeatable local number, nothing more.
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    gateway_basic: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.PERF_RATE || 5), // req/s -- well under the 1000/min (~16.6/s) gateway ceiling
      timeUnit: "1s",
      duration: __ENV.PERF_DURATION || "20s",
      preAllocatedVUs: 10,
      maxVUs: 20,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:gateway_health}": ["p(95)<50", "p(99)<150"],
  },
};

const BASE_URL = __ENV.GATEWAY_URL || "http://127.0.0.1:8080";

export default function () {
  const res = http.get(`${BASE_URL}/health`, {
    tags: { name: "gateway_health" },
  });
  check(res, {
    "status is 200": (r) => r.status === 200,
  });
}
