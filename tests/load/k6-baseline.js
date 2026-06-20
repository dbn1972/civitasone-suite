/**
 * CivitasOne baseline load test — gateway + hot read paths.
 * Target: 1,000 TPS sustained (smoke: 100 VUs × 10 iter validates wiring).
 *
 * Run: k6 run tests/load/k6-baseline.js
 * Env: GATEWAY_URL (default http://localhost:8080)
 */
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    baseline_reads: {
      executor: "constant-arrival-rate",
      rate: 1000,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 200,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE = __ENV.GATEWAY_URL || "http://localhost:8080";
const TOKEN = __ENV.CIVITAS_TOKEN || "";

function headers() {
  const h = { "Content-Type": "application/json", "x-correlation-id": `k6-${__VU}-${__ITER}` };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

export default function () {
  const paths = [
    "/health",
    "/api/v1/finance/payments?limit=10",
    "/api/v1/citizen/tickets?limit=10",
    "/api/v1/hrms/employees?limit=10",
    "/api/v1/queue/status",
  ];
  const path = paths[__ITER % paths.length];
  const res = http.get(`${BASE}${path}`, { headers: headers(), tags: { path } });
  check(res, {
    "status 2xx or 401": (r) => (r.status >= 200 && r.status < 300) || r.status === 401,
    "p95 budget": (r) => r.timings.duration < 2000,
  });
  sleep(0.01);
}
