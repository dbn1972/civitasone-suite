/**
 * ST-M01-11 — payroll posting consumer (SmartTransfer OS).
 *
 * Consumes the frozen `hrms.posting.changed` event (contract pack #1976) and
 * appends a dated posting/DDO history row (migration 0087). This is the FF-05
 * fix from M00 ("hrms.employee.transferred has no subscriber, so payroll is
 * blind to postings"), scoped to D-ST-13 option (a): record the posting FACT
 * only. NO pay computation, NO TA/DA, NO mid-month split, NO HRA class
 * derivation — all PROPOSED under D-ST-13/14 and left open.
 *
 * House rule 1 (write path): the single transaction runs markProcessed + the
 * guarded insert + audit.event.record. Idempotent on the ORIGINATING EVENT ID
 * two ways: markProcessed on the per-message id (a true queue redelivery is
 * dropped before any write) AND the (tenant_id, event_id) UNIQUE on the history
 * table (a semantically identical re-emission of the same posting event writes
 * nothing — ON CONFLICT DO NOTHING).
 *
 * OPTIONAL / no-op when the tenant lacks payroll: this consumer lives in a
 * stand-alone module file, registered minimally in worker.ts behind
 * PAYROLL_POSTING_CONSUMER_ENABLED (default off) — see config.ts for why an env
 * flag is used (no reliable in-service per-tenant entitlement signal). When the
 * flag is on, a tenant that is NOT in the PAYROLL_POSTING_TENANTS allow-list is
 * a clean markProcessed-only no-op (nothing is written), satisfying "the
 * consumer must no-op when the tenant lacks the payroll module".
 *
 * This file is deliberately its OWN module (not folded into the 2,457-line
 * payroll consumer.ts one-lane file; ERP backlog lane rule) and is registered
 * with one line in worker.ts.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { POSTING_CHANGED_TOPIC } from "./topic.js";
import { isPostingConsumerEnabled, tenantHasPayroll } from "./config.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

/** The frozen `hrms.posting.changed` payload shape (packages/events pack). */
interface PostingChangedPayload {
  employeeId: string;
  tenantId: string;
  fromOfficeId: string;
  toOfficeId: string;
  station: string;
  state: string;
  cityClass: string;
  /** Optional: no DDO source in Workforce Core today (D-ST-14 PROPOSED). */
  ddo?: string;
  effectiveFrom: string;
  orderNumber: string;
}

/**
 * Register the posting consumer. Call site (worker.ts) is already gated on
 * isPostingConsumerEnabled(); the guard is re-asserted here so a direct call in
 * a test cannot accidentally subscribe when the flag is off.
 */
export function registerPostingConsumers(queue: Queue): void {
  if (!isPostingConsumerEnabled()) return;

  queue.subscribe(POSTING_CHANGED_TOPIC, async (msg) => {
    const p = msg.payload as PostingChangedPayload;
    await db.transaction(async (tx) => {
      // Queue-level idempotency: a true redelivery is dropped before any write.
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Per-tenant no-op when the tenant lacks payroll: markProcessed has run,
      // nothing else. The posting event is acknowledged (not dead-lettered or
      // retried) for a non-payroll tenant, exactly as the row requires.
      if (!tenantHasPayroll(msg.tenantId)) return;

      // Store ONLY what the event carries (D-ST-13 option (a)): the dated
      // office move + station/state/city-class + optional DDO. The event id
      // (messageId) is the idempotency key on the (tenant_id, event_id)
      // UNIQUE, so a semantically identical re-emission writes nothing.
      const written = await repo.insertPostingTx(tx, {
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        fromOfficeId: p.fromOfficeId,
        toOfficeId: p.toOfficeId,
        station: p.station,
        state: p.state,
        cityClass: p.cityClass,
        ddo: p.ddo ?? null,
        effectiveFrom: p.effectiveFrom,
        orderNumber: p.orderNumber,
        eventId: msg.messageId,
        createdBy: msg.actorId,
      });

      // Audit only a genuine first write (ON CONFLICT ⇒ written=false on a
      // duplicate event body), so the audit log mirrors the history exactly.
      if (written) {
        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "posting_history_record",
            resourceType: "posting_history",
            resourceId: p.employeeId,
            outcome: "success",
            metadata: {
              employeeId: p.employeeId,
              fromOfficeId: p.fromOfficeId,
              toOfficeId: p.toOfficeId,
              effectiveFrom: p.effectiveFrom,
              orderNumber: p.orderNumber,
              // Carried for a future (D-ST-13/14) payroll consequence; not
              // acted on today.
              cityClass: p.cityClass,
              ...(p.ddo ? { ddo: p.ddo } : {}),
            },
          },
        });
      }
    });
  });
}
