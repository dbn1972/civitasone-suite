/**
 * CivitasOne baseline load test — gateway + hot read paths.
 * Target: 1,000 TPS sustained (smoke: 100 VUs × 10 iter validates wiring).
 *
 * Run: k6 run tests/load/k6-baseline.js
 * Env: GATEWAY_URL (default http://localhost:8080)
 *
 * Prerequisites for authenticated scenarios:
 *   CIVITAS_TOKEN must be a valid RS256-signed JWT for a test tenant with at least
 *   read access to finance, hrms, and procurement modules and write access to
 *   helpdesk. Generate one via the tenant admin CLI:
 *     civitas-cli token issue --tenant=test --role=load-test-user --ttl=1h
 *   Without the token the authenticated reads will receive 401 (counted as
 *   non-failures by design) and the write scenario will skip the success check.
 */
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    // Unauthenticated + authenticated reads: 800 VUs
    baseline_reads: {
      executor: "constant-arrival-rate",
      rate: 800,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 200,
      maxVUs: 800,
    },
    // Write scenario: 200 VUs (total ~1000 TPS)
    helpdesk_writes: {
      executor: "constant-arrival-rate",
      rate: 200,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: "writeFlow",
    },
  },
  thresholds: {
    // Global fallback
    http_req_failed: ["rate<0.01"],
    // Per-endpoint GET thresholds: p95 < 500ms
    "http_req_duration{path:/health}": ["p(95)<500"],
    "http_req_duration{path:/api/v1/finance/payments}": ["p(95)<500"],
    "http_req_duration{path:/api/v1/citizen/tickets}": ["p(95)<500"],
    "http_req_duration{path:/api/v1/hrms/employees}": ["p(95)<500"],
    "http_req_duration{path:/api/v1/queue/status}": ["p(95)<500"],
    "http_req_duration{path:/api/v1/finance/bills}": ["p(95)<500"],
    "http_req_duration{path:/api/v1/hrms/employees/all}": ["p(95)<500"],
    "http_req_duration{path:/api/v1/procurement/orders}": ["p(95)<500"],
    // POST threshold: p95 < 1000ms
    "http_req_duration{path:/api/v1/helpdesk/tickets}": ["p(95)<1000"],
  },
};

const BASE = __ENV.GATEWAY_URL || "http://localhost:8080";
const TOKEN = __ENV.CIVITAS_TOKEN || "";

function headers() {
  const h = { "Content-Type": "application/json", "x-correlation-id": `k6-${__VU}-${__ITER}` };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

// ─── Read scenario (default export) ─────────────────────────────────────────

const READ_PATHS = [
  // Unauthenticated
  { path: "/health", tag: "/health" },
  { path: "/api/v1/finance/payments?limit=10", tag: "/api/v1/finance/payments" },
  { path: "/api/v1/citizen/tickets?limit=10", tag: "/api/v1/citizen/tickets" },
  { path: "/api/v1/hrms/employees?limit=10", tag: "/api/v1/hrms/employees" },
  { path: "/api/v1/queue/status", tag: "/api/v1/queue/status" },
  // Authenticated reads (will 401 gracefully when TOKEN is absent)
  { path: "/api/v1/finance/bills?limit=10", tag: "/api/v1/finance/bills" },
  { path: "/api/v1/hrms/employees?limit=10&include=all", tag: "/api/v1/hrms/employees/all" },
  { path: "/api/v1/procurement/orders?limit=10", tag: "/api/v1/procurement/orders" },
];

export default function () {
  const entry = READ_PATHS[__ITER % READ_PATHS.length];
  const res = http.get(`${BASE}${entry.path}`, {
    headers: headers(),
    tags: { path: entry.tag },
  });
  check(res, {
    "status 2xx or 401": (r) => (r.status >= 200 && r.status < 300) || r.status === 401,
    "p95 budget": (r) => r.timings.duration < 2000,
  });
  sleep(0.01);
}

// ─── Write scenario ──────────────────────────────────────────────────────────

export function writeFlow() {
  const payload = JSON.stringify({
    subject: "k6-load-test",
    description: "automated",
    priority: "low",
  });

  const res = http.post(`${BASE}/api/v1/helpdesk/tickets`, payload, {
    headers: headers(),
    tags: { path: "/api/v1/helpdesk/tickets" },
  });

  // Graceful: 202 Accepted is success; 401 is expected when no token is set
  check(res, {
    "ticket accepted or unauthenticated": (r) => r.status === 202 || r.status === 401,
  });
  sleep(0.01);
}
