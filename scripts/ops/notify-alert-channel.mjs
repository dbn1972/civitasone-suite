#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// notify-alert-channel.mjs — G10 Drill_Scheduler failure notification
//
// Posts to the platform's EXISTING alerting channel (Req 12.4) — it does not
// stand up a new notification path. Two channels are already documented for
// the platform's alerting stack (infra/observability/alertmanager.yml):
//
//   1. ALERTMANAGER_SLACK_WEBHOOK — the Slack incoming-webhook URL already
//      referenced (as optional) in alertmanager.yml's header comment. When
//      configured, this script posts directly to it (Slack's basic
//      `{ text }` payload shape) — the most direct "existing alerting
//      channel" a chat-ops team already watches.
//   2. ALERTMANAGER_URL — the deployed Alertmanager instance
//      (infra/observability/prometheus.yml points Prometheus at
//      `alertmanager:9093`). When configured (and no Slack webhook is set),
//      this script POSTs a synthetic alert to Alertmanager's v2 API
//      (`POST /api/v2/alerts`) with `severity: critical`, which the existing
//      routing tree (`route.routes[severity=critical]` → `pagerduty-critical`)
//      delivers through the platform's already-configured PagerDuty/email
//      receivers — no new routing rule is added by this script.
//
// Per tech.md's "fail-fast on missing config" rule, if NEITHER env var is
// configured this script exits non-zero with a descriptive error rather than
// silently no-op'ing — a DR drill failure notification that silently
// vanishes because of a missing env var is exactly the kind of "safe
// default" tech.md forbids.
//
// Called by the Drill_Scheduler (.github/workflows/dr-drill.yml, task 16.5)
// only on a failing scheduled run (`if: failure()`), and independently
// no-ops (informational log, exit 0) when passed a --report whose aggregated
// outcome is "pass" — so a direct invocation with a report is safe to always
// run (not just behind a shell-level `if: failure()` gate).
//
// Usage:
//   node scripts/ops/notify-alert-channel.mjs "DR drill failed — see run 12345"
//   node scripts/ops/notify-alert-channel.mjs "DR drill failed" --report drill-report.json
//
// Env vars (first configured one wins — see header above):
//   ALERTMANAGER_SLACK_WEBHOOK   — Slack incoming-webhook URL
//   ALERTMANAGER_URL             — Alertmanager base URL (default API path: /api/v2/alerts)
//
// Exit codes:
//   0 — notified successfully, OR no-op because the report shows an overall pass
//   1 — posting to the alert channel failed (network/API error)
//   2 — invalid input, or neither ALERTMANAGER_SLACK_WEBHOOK nor ALERTMANAGER_URL is configured
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { redactLogPayload } from "../../packages/observability/dist/redaction.js";
import { aggregateOutcomes, TIER01_SERVICES } from "./lib/outcome-aggregation.mjs";
import { extractOutcomes } from "./publish-drill-report.mjs";

function parseArgs(argv) {
  const opts = { message: null, report: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--report") {
      opts.report = argv[++i] ?? null;
    } else {
      positional.push(arg);
    }
  }
  opts.message = positional[0] ?? null;
  return opts;
}

/**
 * Determine whether a notification should actually be sent. With no --report
 * supplied, this script trusts its caller (the Drill_Scheduler invokes it
 * only `if: failure()`) and always notifies. With a --report supplied, it
 * independently re-derives the Tier-0/Tier-1 pass/fail verdict via the same
 * shared aggregation rule used by restore-drill.sh / publish-drill-report.mjs,
 * so a direct/manual invocation is safe to call unconditionally.
 */
export function shouldNotify(reportJson) {
  if (reportJson === null) return { notify: true, aggregation: null };
  const outcomesByService = extractOutcomes(reportJson);
  const drilledCritical = Object.keys(outcomesByService).filter((s) => TIER01_SERVICES.includes(s));
  const criticalServices = drilledCritical.length > 0 ? drilledCritical : TIER01_SERVICES;
  const aggregation = aggregateOutcomes(outcomesByService, criticalServices);
  return { notify: aggregation.overall === "fail", aggregation };
}

function buildSlackPayload(message, aggregation) {
  const lines = [`:rotating_light: *CivitasOne DR Drill Failure*`, message];
  if (aggregation) {
    lines.push(`Failed: ${aggregation.failedServices.join(", ") || "—"}`);
    if (aggregation.missingServices.length > 0) {
      lines.push(`Missing (unreported): ${aggregation.missingServices.join(", ")}`);
    }
  }
  return { text: lines.join("\n") };
}

function buildAlertmanagerPayload(message, aggregation) {
  const now = new Date().toISOString();
  return [
    {
      labels: {
        alertname: "DrDrillFailed",
        severity: "critical",
        team: "platform",
        service: "dr-drill-scheduler",
      },
      annotations: {
        summary: "CivitasOne DR restore drill failed",
        description: message,
        ...(aggregation ? { failedServices: aggregation.failedServices.join(", ") || "none" } : {}),
      },
      startsAt: now,
    },
  ];
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 500)}` : ""}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.message) {
    console.error("notify-alert-channel: a message argument is required — node scripts/ops/notify-alert-channel.mjs \"<message>\" [--report drill-report.json]");
    process.exit(2);
    return;
  }

  let reportJson = null;
  if (opts.report) {
    try {
      reportJson = JSON.parse(readFileSync(opts.report, "utf8"));
    } catch (err) {
      console.error(`notify-alert-channel: failed to read/parse --report ${opts.report} — ${err.message}`);
      process.exit(2);
      return;
    }
  }

  const { notify, aggregation } = shouldNotify(reportJson);
  if (!notify) {
    console.log("notify-alert-channel: all Tier-0/Tier-1 services passed — no-op (no alert sent).");
    process.exit(0);
    return;
  }

  // Req 15.4: structured log entries emitted here exclude tenant PII and
  // credentials and carry a correlationId.
  const logPayload = redactLogPayload({ event: "dr_drill_alert", message: opts.message, aggregation });
  console.log(JSON.stringify(logPayload));

  const slackWebhook = process.env.ALERTMANAGER_SLACK_WEBHOOK;
  const alertmanagerUrl = process.env.ALERTMANAGER_URL;

  if (!slackWebhook && !alertmanagerUrl) {
    console.error(
      "notify-alert-channel: neither ALERTMANAGER_SLACK_WEBHOOK nor ALERTMANAGER_URL is configured — " +
        "cannot reach the platform's alerting channel. Set one of these env vars (see infra/observability/alertmanager.yml).",
    );
    process.exit(2);
    return;
  }

  try {
    if (slackWebhook) {
      await postJson(slackWebhook, buildSlackPayload(opts.message, aggregation));
      console.log("notify-alert-channel: posted to Slack via ALERTMANAGER_SLACK_WEBHOOK.");
    } else {
      const base = alertmanagerUrl.replace(/\/+$/, "");
      await postJson(`${base}/api/v2/alerts`, buildAlertmanagerPayload(opts.message, aggregation));
      console.log("notify-alert-channel: posted alert to Alertmanager.");
    }
  } catch (err) {
    console.error(`notify-alert-channel: failed to post to the alerting channel — ${err.message}`);
    process.exit(1);
    return;
  }

  process.exit(0);
}

// Only run when executed directly (not when imported by fixture unit tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`notify-alert-channel: fatal — ${err?.stack || err}`);
    process.exit(2);
  });
}
