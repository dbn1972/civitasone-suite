/**
 * CR-MKT-04 — scheduled domain-authentication checker.
 *
 * This is the ONLY place that talks to DNS. It scans enabled sending domains
 * across tenants (read-only, via the BYPASSRLS scanner pool — a cross-tenant
 * SELECT under the NOBYPASSRLS service role returns zero rows), resolves the
 * TXT records with an injectable resolver, and publishes a
 * `notification.email.domain_auth_check.record` command carrying the observed
 * strings. The consumer does the evaluation and the write, so the record path
 * stays identical whether the result came from the scheduler or an operator.
 *
 * The resolver is a parameter, so tests drive this end-to-end with a stub and
 * make no network call.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { scannerDb } from "../../shared/scanner-db.js";
import { COMMANDS } from "../../topics.js";
import { sendingDomains } from "./schema.js";
import { probeDomainAuth, nodeDnsResolver, type DnsResolver } from "./dns.js";
import type { DmarcPolicy } from "./domain.js";

const log = pino({ name: "notification:domain-auth-sweeper" });

/** System actor for scheduler-originated writes. */
const SCHEDULER_ACTOR = "00000000-0000-4000-8000-000000000000";

export async function sweepDomainAuthChecks(
  queue: Queue,
  resolver: DnsResolver = nodeDnsResolver,
  limit = 100,
): Promise<number> {
  const domains = await scannerDb
    .select()
    .from(sendingDomains)
    .where(eq(sendingDomains.enabled, true))
    .limit(limit);

  let submitted = 0;
  for (const d of domains) {
    try {
      const observed = await probeDomainAuth(resolver, d.domain, {
        dkimSelector: d.dkimSelector,
        dkimValue: d.dkimValue,
        spfInclude: d.spfInclude,
        dmarcPolicy: d.dmarcPolicy as DmarcPolicy,
      });
      await queue.publish(COMMANDS.recordDomainAuthCheck, {
        messageId: randomUUID(),
        type: COMMANDS.recordDomainAuthCheck,
        tenantId: d.tenantId,
        actorId: SCHEDULER_ACTOR,
        correlationId: d.id,
        schemaVersion: "1.0",
        payload: {
          id: randomUUID(),
          tenantId: d.tenantId,
          sendingDomainId: d.id,
          dkimTxt: observed.dkimTxt,
          spfTxt: observed.spfTxt,
          dmarcTxt: observed.dmarcTxt,
          source: "scheduled",
          checkedAt: new Date().toISOString(),
        },
      });
      submitted++;
    } catch (err) {
      // A resolver failure for one domain must not abort the sweep.
      log.warn({ err, sendingDomainId: d.id }, "domain auth probe failed; will retry next sweep");
    }
  }

  if (submitted > 0) log.info({ submitted }, "domain auth sweep cycle complete");
  return submitted;
}

/** Run sweepDomainAuthChecks on an interval (default: 6 hours). */
export function startDomainAuthSweeper(queue: Queue, intervalMs = 6 * 60 * 60_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepDomainAuthChecks(queue).catch((err) => log.warn({ err }, "domain auth sweep cycle failed"));
  }, intervalMs);
}
