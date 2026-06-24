#!/usr/bin/env node
/**
 * verify-flows.mjs — LIVE behavioral proof of two cross-service event flows
 * against the RUNNING CivitasOne fleet (gateway :8080, Keycloak :8180,
 * Postgres docker container `civitasone-postgres`).
 *
 * No external deps: uses global fetch + node:child_process for psql via docker exec.
 *
 * Flow-4 (grant -> finance):
 *   POST /v1/grants/applications/{appId}/uc  (emits COMMANDS.ucSubmit)
 *     -> grant utilisation consumer inserts utilisation.grant_uc_statements
 *        and emits EVENTS.ucSubmitted = "grant.uc.submitted"
 *     -> finance integrations consumer (CONSUMED_EVENTS.grantUcSubmitted)
 *        emits EVENTS.ucReconciled = "finance.uc.reconciled"
 *   DB EVIDENCE: a row in civitas_finance._outbox.messages with
 *        topic='finance.uc.reconciled' and payload->>'ucId' = <ucId>.
 *   See: services/finance-service/src/modules/integrations/consumer.ts:183-205
 *        services/grant-service/src/modules/utilisation/consumer.ts:50-54
 *
 * Flow-6 (workflow -> notification):
 *   POST /v1/workflow/instances           (spawns the first task)
 *   POST /v1/workflow/tasks/{taskId}/complete (emits workflow.task.completed
 *        + notification.send via the tasks consumer's emit())
 *     -> notification-service deliveries consumer (COMMANDS.sendNotification =
 *        "notification.send") inserts deliveries.deliveries row.
 *   DB EVIDENCE:
 *     (a) civitas_workflow._outbox.messages topic='notification.send'
 *         correlation_id=<corr> (the producer emitted it)
 *     (b) civitas_notification.deliveries.deliveries recipient=<actorId>
 *         created_at >= <runStart> (the consumer wrote the notification row)
 *   See: services/workflow-service/src/modules/tasks/consumer.ts:362-380
 *        services/notification-service/src/modules/deliveries/consumer.ts:43-66
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const KEYCLOAK = process.env.KEYCLOAK_URL ?? "http://localhost:8180";
const PG_CONTAINER = process.env.PG_CONTAINER ?? "civitasone-postgres";
const PG_USER = process.env.PG_USER ?? "civitas_admin";

const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS ?? 45000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 1000);

// ── ANSI helpers ──────────────────────────────────────────────────────────
const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);

// ── psql via docker exec (no shell, args array — injection-safe) ────────────
async function psql(db, query) {
  const args = ["exec", PG_CONTAINER, "psql", "-U", PG_USER, "-d", db, "-tAc", query];
  const { stdout } = await execFileAsync("docker", args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

// The shared @civitasone/outbox stores `payload` jsonb as a double-encoded JSON
// STRING scalar (jsonb_typeof = 'string'), so `payload->>'key'` is NULL and any
// `||` concatenation involving it collapses the whole expression to NULL. This
// fragment normalizes payload back to an object whether it was stored as a
// string scalar or a real object, so `<NORM>->>'key'` works in either case.
const NORM = "(CASE WHEN jsonb_typeof(payload)='string' THEN (payload #>> '{}')::jsonb ELSE payload END)";

// ── token ───────────────────────────────────────────────────────────────────
async function mintToken() {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "civitasone-admin-cli",
    client_secret: "civitas_admin_cli_secret_dev",
    username: "dev-superadmin",
    password: "Verify@2026Live",
  });
  const res = await fetch(`${KEYCLOAK}/realms/civitasone/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token mint failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

function decodeJwt(token) {
  const part = token.split(".")[1];
  const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
}

// ── HTTP through the gateway ─────────────────────────────────────────────────
async function api(token, method, path, { body, correlationId } = {}) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (correlationId) headers["x-correlation-id"] = correlationId;
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

// ── poll until predicate returns truthy (the evidence string) or timeout ─────
async function pollFor(label, fn) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

// ── Flow-4 ───────────────────────────────────────────────────────────────────
async function flow4(token, ctx) {
  log(c.b("\n=== Flow-4: grant.uc.submitted -> finance.uc.reconciled ==="));
  const appId = randomUUID();
  const corr = randomUUID();
  // utilisedMinor MUST be <= total disbursed for the application (grant domain
  // assertUcExpenditureWithinDisbursed). A synthetic application has no
  // disbursements (disbursed=0), so utilisedMinor must be 0 for ucSubmitted to fire.
  const reqBody = { period: "2025-26", releasedMinor: 1000000, utilisedMinor: 0, ucRef: `verify-${corr.slice(0, 8)}` };

  log(c.dim(`POST /api/v1/grants/applications/${appId}/uc  corr=${corr}`));
  const res = await api(token, "POST", `/api/v1/grants/applications/${appId}/uc`, { body: reqBody, correlationId: corr });
  if (res.status !== 202 && res.status !== 200) {
    log(c.r(`  producer call failed: HTTP ${res.status} ${JSON.stringify(res.body)}`));
    return { name: "Flow-4", pass: false, detail: `producer HTTP ${res.status}` };
  }
  const ucId = res.body?.id;
  log(c.dim(`  accepted ucId=${ucId} status=${res.body?.status}`));
  if (!ucId) return { name: "Flow-4", pass: false, detail: "no ucId in accepted response" };

  // intermediate evidence: grant UC statement row landed in grant DB
  const grantRow = await pollFor("grant-uc", async () =>
    psql("civitas_grant",
      `SELECT concat_ws('|', id::text, 'status='||status, 'utilised='||utilised_minor) FROM utilisation.grant_uc_statements WHERE id='${ucId}'`));
  if (grantRow) log(c.dim(`  [grant]   utilisation.grant_uc_statements: ${grantRow}`));
  else log(c.y(`  [grant]   UC statement row not yet visible (continuing to downstream check)`));

  // downstream evidence: finance emitted finance.uc.reconciled for this ucId
  const q =
    `SELECT concat_ws('|', id::text, 'outcome='||COALESCE(pj->>'outcome',''), ` +
    `'utilisedMinor='||COALESCE(pj->>'utilisedMinor',''), 'corr='||correlation_id, ` +
    `'published='||COALESCE(published_at::text,'pending')) ` +
    `FROM (SELECT id, correlation_id, published_at, ${NORM} AS pj ` +
    `FROM _outbox.messages WHERE topic='finance.uc.reconciled') t ` +
    `WHERE pj->>'ucId'='${ucId}' LIMIT 1`;
  const fin = await pollFor("finance-reconciled", async () => psql("civitas_finance", q));

  if (fin) {
    log(c.g(`  [finance] _outbox.messages topic=finance.uc.reconciled: ${fin}`));
    return { name: "Flow-4", pass: true, ucId, evidence: fin };
  }
  log(c.r(`  [finance] no finance.uc.reconciled row for ucId=${ucId} within ${POLL_TIMEOUT_MS}ms`));
  return { name: "Flow-4", pass: false, detail: `no finance.uc.reconciled for ucId=${ucId}` };
}

// ── Flow-6 ───────────────────────────────────────────────────────────────────
async function flow6(token, ctx) {
  log(c.b("\n=== Flow-6: workflow task complete -> notification.send + notification row ==="));
  const corr = randomUUID();
  const runStart = (await psql("civitas_notification", "SELECT now()")).trim();

  // 1. create a workflow instance -> spawns the first task ("Review")
  log(c.dim(`POST /api/v1/workflow/instances  corr=${corr}`));
  const inst = await api(token, "POST", "/api/v1/workflow/instances",
    { body: { name: `verify-flow6-${corr.slice(0, 8)}` }, correlationId: corr });
  if (inst.status !== 202 && inst.status !== 200) {
    log(c.r(`  create instance failed: HTTP ${inst.status} ${JSON.stringify(inst.body)}`));
    return { name: "Flow-6", pass: false, detail: `create instance HTTP ${inst.status}` };
  }
  const instanceId = inst.body?.id;
  log(c.dim(`  accepted instanceId=${instanceId}`));

  // 2. wait for the consumer to spawn the task, then read its id from the DB
  const taskId = await pollFor("task-spawn", async () =>
    psql("civitas_workflow", `SELECT id FROM workflow.tasks WHERE instance_id='${instanceId}' ORDER BY created_at LIMIT 1`));
  if (!taskId) return { name: "Flow-6", pass: false, detail: `no task spawned for instance ${instanceId}` };
  log(c.dim(`  spawned taskId=${taskId}`));

  // 3. complete the task (super_admin break-glass passes the SoD self-approval gate)
  log(c.dim(`POST /api/v1/workflow/tasks/${taskId}/complete`));
  const comp = await api(token, "POST", `/api/v1/workflow/tasks/${taskId}/complete`,
    { body: { decision: "approve" }, correlationId: corr });
  if (comp.status !== 202 && comp.status !== 200) {
    log(c.r(`  complete task failed: HTTP ${comp.status} ${JSON.stringify(comp.body)}`));
    return { name: "Flow-6", pass: false, detail: `complete task HTTP ${comp.status}` };
  }
  log(c.dim(`  accepted status=${comp.body?.status}`));

  // 4. producer evidence: workflow emitted notification.send with our corr id
  const wfQ =
    `SELECT concat_ws('|', id::text, 'recipient='||COALESCE(pj->>'recipient',''), ` +
    `'template='||COALESCE(pj->>'templateId',''), 'eventType='||COALESCE(pj->>'eventType',''), ` +
    `'corr='||correlation_id) ` +
    `FROM (SELECT id, correlation_id, ${NORM} AS pj ` +
    `FROM _outbox.messages WHERE topic='notification.send' AND correlation_id='${corr}') t LIMIT 1`;
  const wfEvidence = await pollFor("workflow-notification-send", async () => psql("civitas_workflow", wfQ));
  if (wfEvidence) log(c.g(`  [workflow]     _outbox.messages topic=notification.send: ${wfEvidence}`));
  else log(c.r(`  [workflow]     no notification.send emitted for corr=${corr}`));

  // 5. consumer evidence: notification-service wrote a delivery (notification) row.
  //    deliveries.deliveries carries no correlation_id/eventType, so we correlate
  //    by recipient (= actorId, since the task had no roleRef) within this run's
  //    time window.
  const recipient = ctx.actorId;
  const ntQ =
    `SELECT concat_ws('|', id::text, 'recipient='||recipient, 'template='||template_id, ` +
    `'channel='||channel, 'status='||status) ` +
    `FROM deliveries.deliveries WHERE recipient='${recipient}' AND created_at >= '${runStart}' ` +
    `ORDER BY created_at DESC LIMIT 1`;
  const ntEvidence = await pollFor("notification-row", async () => psql("civitas_notification", ntQ));
  if (ntEvidence) log(c.g(`  [notification] deliveries.deliveries: ${ntEvidence}`));
  else log(c.r(`  [notification] no delivery row for recipient=${recipient} since ${runStart}`));

  const pass = Boolean(wfEvidence && ntEvidence);
  return {
    name: "Flow-6",
    pass,
    instanceId,
    taskId,
    evidence: { producer: wfEvidence, consumer: ntEvidence },
    ...(pass ? {} : { detail: `notification.send=${Boolean(wfEvidence)} deliveryRow=${Boolean(ntEvidence)}` }),
  };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(c.b("CivitasOne live cross-service flow verification"));
  log(c.dim(`gateway=${GATEWAY} keycloak=${KEYCLOAK} pg=${PG_CONTAINER} timeout=${POLL_TIMEOUT_MS}ms`));

  const token = await mintToken();
  const claims = decodeJwt(token);
  const ctx = { actorId: claims.sub, tenantId: claims.tid ?? claims.tenantId };
  log(c.dim(`token ok: actorId(sub)=${ctx.actorId} tenant=${ctx.tenantId} roles=${(claims.roles || claims.realm_access?.roles || []).join(",")}`));

  const results = [];
  results.push(await flow4(token, ctx));
  results.push(await flow6(token, ctx));

  log(c.b("\n=== SUMMARY ==="));
  for (const r of results) {
    log(`  ${r.pass ? c.g("PASS") : c.r("FAIL")}  ${r.name}${r.pass ? "" : "  — " + (r.detail ?? "")}`);
  }
  const allPass = results.every((r) => r.pass);
  log(allPass ? c.g("\nALL FLOWS PASSED") : c.r("\nONE OR MORE FLOWS FAILED"));
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(c.r(`\nfatal: ${err?.stack || err}`));
  process.exit(2);
});
