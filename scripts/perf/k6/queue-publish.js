// PERF-010 -- queue publish tier-0 k6 sanity check.
//
// SCOPE: queue-service (services/queue-service) is a message-bus
// OBSERVABILITY process -- it exposes only GET /health + GET /v1/queue/*
// (status/drivers/ops); it has no HTTP "publish a message" route. Every
// real publish in this fleet happens in-process, inside a domain service,
// via the @civitasone/queue client library (see
// services/queue-service/src/client-bridge.ts's wrapQueueAsClient) --
// there is no network-facing endpoint whose entire job is "publish", so a
// pure k6 HTTP load test cannot target queue-service directly for this SLI.
//
// The closest REAL, working proxy is POST /identity/sessions (see
// services/identity-service/src/modules/sessions/routes.ts +
// modules/sessions/commands.ts#createSession): its handler does auth +
// validation and then calls `queue.publish(...)` directly -- no DB write in
// the synchronous path -- before returning 202. So this measures
// identity-service's own request handling PLUS one real bus.publish() call.
//
// IMPORTANT CAVEAT: this dev/local stack runs with QUEUE_DRIVER=memory
// (see scripts/perf/start-stack.sh), so "publish" here is an in-process
// JS call into an in-memory queue implementation, NOT a network round trip
// to SQS/RabbitMQ the way production (QUEUE_DRIVER=sqs, per
// infra/docker-compose.prod.yml) would incur. The number below is a real,
// repeatable measurement of this code path on this host, but it does NOT
// include real broker latency -- do not read it as validating the
// production "publish < 100ms" SLO end-to-end.
//
// LIVE FINDING (this PR): running this test against the shared dev fleet
// surfaced a REAL failure, not a test artifact -- civitasone-localstack (the
// SQS backing for QUEUE_DRIVER=sqs) is memory-capped at 1GiB, was already
// sitting at ~99.7% memory use, and `docker ps` reported it `unhealthy` for
// its entire ~11-day uptime. Under even light concurrent load, POST
// /identity/sessions (and therefore queue.publish -> SQS SendMessage)
// started hanging indefinitely instead of returning 202. This is a genuine,
// reproducible, currently-broken condition on this host, not a k6 script
// bug -- see the PERF-010 PR description and the new gap-report entry filed
// for it. Kept at a deliberately LOW default rate below (2 VUs) so this
// suite does not add more load to an already-degraded shared container; do
// not raise it casually.
//
// THRESHOLDS BELOW ARE DEV-SCALE SANITY NUMBERS, not the documented SLO.
import http from "k6/http";
import { check, sleep } from "k6";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

export const options = {
  scenarios: {
    queue_publish: {
      executor: "constant-vus",
      vus: Number(__ENV.PERF_VUS || 2),
      duration: __ENV.PERF_DURATION || "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:session_create}": ["p(95)<100", "p(99)<250"],
  },
};

const BASE_URL = __ENV.IDENTITY_URL || "http://127.0.0.1:3001";
const TOKEN = __ENV.PERF_JWT;
const TENANT_ID = __ENV.PERF_TENANT_ID || "00000000-0000-4000-8000-000000000001";
if (!TOKEN) {
  throw new Error("PERF_JWT env var is required (mint with scripts/perf/mint-perf-token.cjs)");
}

export default function () {
  const userId = uuidv4();
  const body = JSON.stringify({
    tenantId: TENANT_ID,
    userId,
    ip: "127.0.0.1",
    device: "k6-load-test",
    trusted: false,
    ttlSeconds: 1800,
  });
  const res = http.post(`${BASE_URL}/identity/sessions`, body, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    tags: { name: "session_create" },
  });
  check(res, {
    "status is 202": (r) => r.status === 202,
  });
  sleep(0.05);
}
