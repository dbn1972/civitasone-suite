/**
 * Medical insurance persistence consumers (upsert / delete).
 *
 * Each handler runs in ONE transaction under the message's tenant RLS context
 * (tenantScoped): markProcessed (per-command messageId, so a redelivered
 * command is a no-op) + the guarded write + the audit event.
 *
 * The payload carries the card number / scheme id already encrypted; they are
 * stored as-is. The audit event records WHAT changed (scheme type, whether the
 * card number / scheme id changed) but never the card number itself, in any
 * form, and nothing here logs a payload.
 */
import type { Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { medicalInsurance } from "./schema.js";
import type { InsuranceUpsertPayload } from "./insurance.js";

const log = pino({ name: "hrms-medical-insurance-consumer" });
const AUDIT = "audit.event.record";

export function registerMedicalInsuranceConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.medicalInsuranceUpsert, async (msg) => {
    const p = msg.payload as InsuranceUpsertPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // The route already 404s an unknown employee; re-check inside the write
      // transaction (the employee may have been removed since) instead of
      // letting the FK turn this into a poison message.
      const emp = await tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, p.tenantId), eq(hrmsEmployees.id, p.employeeId))).limit(1);
      if (!emp[0]) {
        log.warn({ employeeId: p.employeeId }, "medical insurance upsert skipped: employee not found");
        return;
      }

      const [existing] = await tx.select({ id: medicalInsurance.id }).from(medicalInsurance)
        .where(and(eq(medicalInsurance.tenantId, p.tenantId), eq(medicalInsurance.employeeId, p.employeeId)))
        .limit(1);

      const now = new Date();
      const fields = {
        schemeType: p.schemeType,
        validityFrom: p.validityFrom,
        validityTo: p.validityTo,
        tier: p.tier,
        dependants: p.dependants,
        annualLimitMinor: p.annualLimitMinor === null ? null : BigInt(p.annualLimitMinor),
        updatedAt: now,
        updatedBy: msg.actorId,
        ...(p.cardNumberEnc !== null ? { cardNumber: p.cardNumberEnc } : {}),
        ...(p.schemeId.action === "set" ? { schemeId: p.schemeId.enc } : {}),
      };

      let recordId: string;
      if (existing) {
        await tx.update(medicalInsurance)
          .set({ ...fields, version: sql`${medicalInsurance.version} + 1` })
          .where(and(eq(medicalInsurance.tenantId, p.tenantId), eq(medicalInsurance.employeeId, p.employeeId)));
        recordId = existing.id;
      } else {
        if (p.cardNumberEnc === null) {
          // The route requires a card number for a new record; the record was
          // deleted between the route check and this write. Nothing to keep.
          log.warn({ employeeId: p.employeeId }, "medical insurance upsert skipped: no record to update and no card number");
          return;
        }
        const inserted = await tx.insert(medicalInsurance).values({
          ...fields,
          id: p.id,
          tenantId: p.tenantId,
          employeeId: p.employeeId,
          cardNumber: p.cardNumberEnc,
          schemeId: p.schemeId.action === "set" ? p.schemeId.enc : null,
          createdBy: msg.actorId,
        }).onConflictDoNothing().returning({ id: medicalInsurance.id });
        if (!inserted[0]) {
          // A concurrent upsert created the record first. Surface it as a
          // failure so the queue retries; the retry takes the update path.
          throw new Error("medical insurance record created concurrently; retrying as update");
        }
        recordId = p.id;
      }

      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: existing ? "update" : "create", resourceType: "medical_insurance",
          resourceId: recordId, outcome: "success",
          metadata: {
            employeeId: p.employeeId,
            schemeType: p.schemeType,
            cardNumberChanged: p.cardNumberEnc !== null,
            schemeIdChanged: p.schemeId.action === "set",
            validityFrom: p.validityFrom,
            validityTo: p.validityTo,
            dependantsCount: p.dependants.length,
          },
        },
      });
    });
  });

  queue.subscribe(COMMANDS.medicalInsuranceDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; employeeId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const deleted = await tx.delete(medicalInsurance)
        .where(and(eq(medicalInsurance.tenantId, p.tenantId), eq(medicalInsurance.employeeId, p.employeeId)))
        .returning({ id: medicalInsurance.id, schemeType: medicalInsurance.schemeType });
      const row = deleted[0];
      if (!row) {
        log.warn({ employeeId: p.employeeId }, "medical insurance delete was a no-op (no record)");
        return;
      }
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "delete", resourceType: "medical_insurance", resourceId: row.id, outcome: "success",
          metadata: { employeeId: p.employeeId, schemeType: row.schemeType },
        },
      });
    });
  });
}
