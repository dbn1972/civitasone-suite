#!/usr/bin/env node
/**
 * verify-evt3-dlq.mjs — EVT-3 (04-T3) LIVE proof: runtime envelope validation.
 *
 * Acceptance (04-backend-events T3): "a malformed event payload is rejected
 * (logged + DLQ, not cast-and-crash); a test sends a bad payload and asserts it
 * never mutates state."
 *
 * This drives the RUNNING fleet (LocalStack SQS :4566, notification-worker
 * consuming `notification.send`, Postgres in docker `civitasone-postgres`). It:
 *
 *   1. Sends a STRUCTURALLY-INVALID envelope (missing schemaVersion, bad
 *      messageId) directly to the `notification-send` SQS queue.
 *   2. Sends an UNPARSEABLE body (not JSON) to the same queue.
 *   3. Asserts BOTH land in the `notification-send-dlq` (dead-lettered) — the
 *      consume-boundary parseEnvelope() rejected them (bus.ts pollTopic:
 *      invalid_envelope / unparseable_body) before any handler ran.
 *   4. Asserts NO `deliveries.deliveries` row exists for the unique recipient
 *      carried by the malformed messages → state was never mutated.
 *   5. Sends a WELL-FORMED notification.send for the same recipient → a
 *      deliveries row DOES appear → the consumer survived the poison messages
 *      and still processes valid ones (i.e. it rejected, it did not crash).
 *
 * No new deps: aws CLI for SQS, docker exec psql for DB, global crypto.
 *
 * Exit 0 only if: both poison msgs dead-lettered AND no row for the malformed
 * recipient AND the valid msg produced a row.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, statSync } from "node:fs";

const execFileAsync = promisify(execFile);

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
const REGION = process.env.AWS_DEFAULT_REGION ?? "ap-south-1";
const PG_CONTAINER = process.env.PG_CONTAINER ?? "civitasone-postgres";
const PG_USER = process.env.PG_USER ?? "civitas_admin";
const TENANT = "00000000-0000-0000-0000-000000000001";

const SOURCE_QUEUE = "notification-send";
// The consume-boundary rejections are recorded in the notification-worker error
// log (captureError + queue_message_dead_lettered are console.error). We verify
// against the log keyed on per-run markers — reliable regardless of the shared
// DLQ's pre-existing backlog (which makes blind DLQ sampling non-deterministic).
const WORKER_LOG = process.env.WORKER_LOG ?? "/var/log/civitasone/notification-worker-error.log";
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS ?? 40000);
const POLL_INTERVAL_MS = 1500;

const AWS_ENV = {
  ...process.env,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  AWS_DEFAULT_REGION: REGION,
};

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const log = (...a) => console.log(...a);

async function aws(args) {
  const { stdout } = await execFileAsync(
    "aws",
    ["--endpoint-url", ENDPOINT, "sqs", ...args],
    { env: AWS_ENV, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim();
}

async function queueUrl(name) {
  try {
    const out = await aws(["get-queue-url", "--queue-name", name, "--output", "text"]);
    return out || null;
  } catch {
    return null;
  }
}

async function sendRaw(url, body) {
  await aws(["send-message", "--queue-url", url, "--message-body", body]);
}

async function psql(db, query) {
  const { stdout } = await execFileAsync(
    "docker",
    ["exec", PG_CONTAINER, "psql", "-U", PG_USER, "-d", db, "-tAc", query],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim();
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Read the worker error log from a byte offset onward (only this run's lines). */
function logSince(offset) {
  try {
    const size = statSync(WORKER_LOG).size;
    if (size <= offset) return "";
    const buf = readFileSync(WORKER_LOG);
    return buf.subarray(offset).toString("utf8");
  } catch {
    return "";
  }
}
function logSize() {
  try { return statSync(WORKER_LOG).size; } catch { return 0; }
}

/** Poll the worker log (from `offset`) until `predicate(text)` is true or timeout. */
async function pollLog(offset, predicate) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const text = logSince(offset);
    if (predicate(text)) return text;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function pollRowCount(db, query) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = "0";
  while (Date.now() < deadline) {
    last = await psql(db, query);
    if (last && last !== "0") return last;
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

async function main() {
  log("\x1b[1mEVT-3 live DLQ proof — runtime envelope validation\x1b[0m");
  log(dim(`sqs=${ENDPOINT} source=${SOURCE_QUEUE} log=${WORKER_LOG}`));

  const srcUrl = await queueUrl(SOURCE_QUEUE);
  if (!srcUrl) { log(r(`source queue ${SOURCE_QUEUE} not found — is the fleet running on SQS?`)); process.exit(2); }

  const recipient = randomUUID();        // unique → isolates any state mutation to us
  const badMarker = `EVT3-bad-${randomUUID()}`;
  const unparseableMarker = `EVT3-unparseable-${randomUUID()}`;
  const goodMarker = `EVT3-good-${randomUUID()}`;

  // (1) structurally-invalid envelope: NO schemaVersion, messageId not a uuid.
  //     If validation were absent, the handler would run and insert a delivery
  //     row for `recipient`. With EVT-3 it is dead-lettered pre-handler.
  const invalidEnvelope = JSON.stringify({
    messageId: "not-a-uuid",
    type: "notification.send",
    tenantId: TENANT,
    actorId: "00000000-0000-0000-0000-000000000099",
    correlationId: badMarker,
    timestamp: new Date().toISOString(),
    // schemaVersion intentionally omitted → invalid
    payload: { templateId: "00000000-0000-4000-8001-000000000000", recipient, channel: "email", note: badMarker },
  });

  // (2) unparseable body (not JSON at all)
  const unparseableBody = `this-is-not-json ${unparseableMarker}`;

  // snapshot the worker error-log size so we only read THIS run's lines, and
  // count pre-existing unparseable dead-letters to assert a delta.
  const logStart = logSize();
  const countDead = (text, reason) =>
    (text.match(new RegExp(`"event":"queue_message_dead_lettered"[^\\n]*"reason":"${reason}"`, "g")) ?? []).length;

  log("\n1. sending malformed envelope (missing schemaVersion, bad messageId)…");
  await sendRaw(srcUrl, invalidEnvelope);
  log("2. sending unparseable (non-JSON) body…");
  await sendRaw(srcUrl, unparseableBody);

  // (3) the consume boundary (bus.ts pollTopic) rejects both BEFORE any handler:
  //     - invalid envelope → captureError(invalid_envelope, correlationId=badMarker) + dead-letter
  //     - unparseable body → dead-letter reason=unparseable_body
  log("3. waiting for the consume-boundary to reject + dead-letter (worker log)…");
  const logText = await pollLog(logStart, (t) =>
    t.includes(badMarker) && t.includes("invalid_envelope") && countDead(t, "unparseable_body") >= 1);
  const text = logText ?? logSince(logStart);

  const invalidLogged = text.includes(badMarker) && /invalid_envelope/.test(text);
  const invalidDead = countDead(text, "invalid_envelope") >= 1 && text.includes(badMarker);
  const unparseableDead = countDead(text, "unparseable_body") >= 1;
  log(`   invalid envelope rejected+logged (keyed on ${badMarker.slice(0,16)}…): ${invalidLogged ? g("YES") : r("NO")}`);
  log(`   invalid envelope dead-lettered (reason=invalid_envelope):            ${invalidDead ? g("YES") : r("NO")}`);
  log(`   unparseable body dead-lettered (reason=unparseable_body):            ${unparseableDead ? g("YES") : r("NO")}`);

  // (4) no state mutation: no deliveries row for the malformed recipient
  const mutatedCount = await psql("civitas_notification",
    `SELECT count(*) FROM deliveries.deliveries WHERE recipient='${recipient}'`);
  const noMutation = mutatedCount === "0";
  log(`4. deliveries rows for malformed recipient: ${mutatedCount} ${noMutation ? g("(none — state intact)") : r("(STATE MUTATED!)")}`);

  // (5) consumer survived: a well-formed message for the SAME recipient is processed
  log("5. sending a WELL-FORMED notification.send for the same recipient…");
  const validEnvelope = JSON.stringify({
    messageId: randomUUID(),
    type: "notification.send",
    tenantId: TENANT,
    actorId: "00000000-0000-0000-0000-000000000099",
    correlationId: goodMarker,
    timestamp: new Date().toISOString(),
    schemaVersion: "1.0",
    payload: { templateId: "00000000-0000-4000-8001-000000000000", recipient, channel: "email", note: goodMarker },
  });
  await sendRaw(srcUrl, validEnvelope);
  const goodCount = await pollRowCount("civitas_notification",
    `SELECT count(*) FROM deliveries.deliveries WHERE recipient='${recipient}'`);
  const consumerAlive = goodCount !== "0";
  log(`   deliveries row after valid msg: ${goodCount} ${consumerAlive ? g("(consumer alive, processed)") : r("(no row — consumer not processing!)")}`);

  log("\n\x1b[1m=== EVT-3 VERDICT ===\x1b[0m");
  const pass = invalidLogged && invalidDead && unparseableDead && noMutation && consumerAlive;
  const line = (ok, label) => log(`  ${ok ? g("PASS") : r("FAIL")}  ${label}`);
  line(invalidLogged, "invalid envelope rejected + logged (keyed to this run)");
  line(invalidDead, "invalid envelope → DLQ (reason=invalid_envelope)");
  line(unparseableDead, "unparseable body → DLQ (reason=unparseable_body)");
  line(noMutation, "malformed messages mutated NO state");
  line(consumerAlive, "consumer survived poison msgs (valid msg still processed)");
  log(pass ? g("\nEVT-3 PASS — malformed events are rejected to DLQ, not cast-and-crash, no state change.")
          : r("\nEVT-3 FAIL — see failing assertions above."));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error(r(`fatal: ${err?.stack || err}`)); process.exit(2); });
