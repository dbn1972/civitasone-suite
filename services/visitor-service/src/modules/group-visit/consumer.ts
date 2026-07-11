/**
 * visitor-service: group-visit consumer.
 *
 * Handles `COMMANDS.groupVisitCreate` and `COMMANDS.groupBulkCheckIn`:
 *
 * groupVisitCreate:
 *   markProcessed(tx, msg.messageId) → insert `group_visits` row →
 *   insert `group_members` rows (per-member blacklist screen via Redis
 *   SISMEMBER, flagging blacklisted members) → insert one `visit_requests`
 *   row (linked via groupVisitId) → generate individual Digital_Passes per
 *   non-blacklisted member (reusing digital-pass domain's `generatePass`)
 *   → insert `digital_passes` rows → outbox `groupVisitCreated`.
 *
 * groupBulkCheckIn:
 *   markProcessed(tx, msg.messageId) → load group members → headcount
 *   reconciliation (domain.ts `confirmBulkCheckIn`) → bulk-transition
 *   non-blacklisted member passes to checked_in → insert check-in rows →
 *   outbox `visitorCheckedIn` per member.
 *
 * Per-member pass generation reuses `modules/digital-pass/domain.ts`'s
 * `generatePass` helper which produces a human-readable pass number +
 * RS256-signed QR JWT (Requirement 9.2). The tenant's QR signing private
 * key is loaded from env (`VISITOR_QR_PRIVATE_KEY`).
 *
 * Graceful degradation: pass generation failures for individual members
 * are logged at WARN and do not fail the entire group — the member row is
 * still created (passId remains null), and the group visit still proceeds
 * for successfully-processed members.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { eq, and } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { groupVisits, groupMembers } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { visitRequests } from "../visit-request/schema.js";
import { generatePass, computeValidityWindow } from "../digital-pass/domain.js";
import { validateGroupSize, confirmBulkCheckIn } from "./domain.js";
import { isBlacklisted } from "../blacklist/screening-store.js";

const log = pino({ name: "group-visit-consumer" });

/** Tenant QR signing key (RS256 PKCS8 PEM). */
function getQrPrivateKey(): string {
  const key = process.env.VISITOR_QR_PRIVATE_KEY;
  if (!key) throw new Error("VISITOR_QR_PRIVATE_KEY env var is required for pass generation");
  return key;
}

// ── Payload Types ──────────────────────────────────────────────────────────

export interface GroupVisitCreatePayload {
  id: string;
  tenantId: string;
  groupName: string;
  purpose: string;
  locationId: string;
  hostEmployeeId: string;
  leadVisitorName: string;
  leadVisitorPhone: string;
  leadVisitorEmail: string | null;
  leadVisitorDocType: string | null;
  leadVisitorDocHash: string | null;
  members: Array<{
    name: string;
    identityDocType: string | null;
    identityDocHash: string | null;
  }>;
  scheduledAt: string | null;
  passType: string;
  permittedAreas: string[];
}

export interface GroupBulkCheckInPayload {
  groupVisitId: string;
  tenantId: string;
  actualHeadcount: number;
  gateId: string | null;
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerGroupVisitConsumers(q: Queue): void {
  q.subscribe<GroupVisitCreatePayload>(COMMANDS.groupVisitCreate, async (msg) => {
    const p = msg.payload;

    // Validate group size (domain rule — Property 16).
    validateGroupSize(p.members.length);

    const privateKey = getQrPrivateKey();
    const now = new Date();

    // Screen each member against blacklist (per-member SISMEMBER, Requirement 9.5).
    const memberScreening = await Promise.all(
      p.members.map(async (m) => ({
        ...m,
        blacklisted: m.identityDocHash ? await isBlacklisted(p.tenantId, m.identityDocHash) : false,
      })),
    );

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // 1. Create visit request linked to this group (Requirement 9.1).
      const visitRequestId = randomUUID();
      await tx.insert(visitRequests).values({
        id: visitRequestId,
        tenantId: p.tenantId,
        locationId: p.locationId,
        hostEmployeeId: p.hostEmployeeId,
        status: "pre_approved",
        purpose: p.purpose,
        scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null,
        passType: p.passType as "single" | "multi_day" | "recurring" | "event",
        groupVisitId: p.id,
        permittedAreas: p.permittedAreas,
        visitorCategory: "delegation",
        source: "portal",
        visitorName: p.leadVisitorName,
        visitorPhone: p.leadVisitorPhone,
        visitorEmail: p.leadVisitorEmail,
        identityDocType: p.leadVisitorDocType,
        createdAt: now,
        createdBy: msg.actorId,
        updatedAt: now,
        updatedBy: msg.actorId,
      });

      // 2. Create group_visits row (Requirement 9.1).
      await tx.insert(groupVisits).values({
        id: p.id,
        tenantId: p.tenantId,
        groupName: p.groupName,
        memberCount: p.members.length,
        purpose: p.purpose,
        visitRequestId,
        createdAt: now,
        createdBy: msg.actorId,
        updatedAt: now,
        updatedBy: msg.actorId,
      });

      // 3. Create group_members rows + individual Digital_Passes per
      //    non-blacklisted member (Requirement 9.2, 9.5).
      const scheduledDate = p.scheduledAt ? new Date(p.scheduledAt) : now;
      const { validFrom, validUntil } = computeValidityWindow(
        (p.passType as "single" | "multi_day" | "recurring" | "event") ?? "single",
        scheduledDate,
        p.passType !== "single" ? new Date(scheduledDate.getTime() + 24 * 60 * 60 * 1000) : undefined,
      );

      for (const member of memberScreening) {
        const memberId = randomUUID();
        let passId: string | null = null;

        // Generate individual digital pass for non-blacklisted members (Requirement 9.2).
        if (!member.blacklisted) {
          try {
            const passData = await generatePass(
              {
                visitId: visitRequestId,
                visitorId: memberId, // member acts as visitor in this context
                tenantId: p.tenantId,
                locationId: p.locationId,
                validFrom,
                validUntil,
                permittedAreas: p.permittedAreas,
                passType: (p.passType as "single" | "multi_day" | "recurring" | "event") ?? "single",
              },
              privateKey,
            );

            passId = randomUUID();
            await tx.insert(digitalPasses).values({
              id: passId,
              tenantId: p.tenantId,
              visitRequestId,
              locationId: p.locationId,
              passNumber: passData.passNumber,
              status: "active",
              passType: p.passType,
              qrJwt: passData.qrJwt,
              validFrom: passData.validFrom,
              validUntil: passData.validUntil,
              permittedAreas: p.permittedAreas,
              createdAt: now,
              createdBy: msg.actorId,
              updatedAt: now,
              updatedBy: msg.actorId,
            });
          } catch (err) {
            // Graceful degradation: log but don't fail the group for one member's pass gen failure.
            log.warn(
              { err, tenantId: p.tenantId, groupVisitId: p.id, memberName: member.name, event: "member_pass_gen_failed" },
              "digital pass generation failed for group member; member row created without pass",
            );
          }
        }

        // Insert group_members row.
        await tx.insert(groupMembers).values({
          id: memberId,
          tenantId: p.tenantId,
          groupVisitId: p.id,
          memberName: member.name,
          identityDocType: member.identityDocType,
          identityDocHash: member.identityDocHash,
          passId,
          blacklisted: member.blacklisted,
          createdAt: now,
          createdBy: msg.actorId,
        });
      }

      // 4. Outbox: groupVisitCreated event.
      await enqueue(tx, {
        topic: EVENTS.groupVisitCreated,
        eventType: EVENTS.groupVisitCreated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { visitRequestId, groupVisitId: p.id, memberCount: p.members.length },
      });
    });

    log.info(
      { tenantId: p.tenantId, groupVisitId: p.id, memberCount: p.members.length, event: "group_visit_created" },
      "group visit created with member passes",
    );
  });

  q.subscribe<GroupBulkCheckInPayload>(COMMANDS.groupBulkCheckIn, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Load the group to get expected headcount.
      const groupRows = await tx
        .select()
        .from(groupVisits)
        .where(and(eq(groupVisits.id, p.groupVisitId), eq(groupVisits.tenantId, p.tenantId)))
        .limit(1);
      const group = groupRows[0];
      if (!group) {
        throw new Error(`group visit '${p.groupVisitId}' not found for tenant '${p.tenantId}'`);
      }

      // Headcount reconciliation (Requirement 9.6, domain logic).
      const reconciliation = confirmBulkCheckIn(group.memberCount, p.actualHeadcount);

      // Load non-blacklisted members with passes for bulk check-in.
      const members = await tx
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupVisitId, p.groupVisitId), eq(groupMembers.blacklisted, false)));

      const now = new Date();

      // Bulk-transition member passes to checked_in.
      for (const member of members) {
        if (!member.passId) continue;

        await tx
          .update(digitalPasses)
          .set({ status: "checked_in", updatedAt: now, updatedBy: msg.actorId })
          .where(and(eq(digitalPasses.id, member.passId), eq(digitalPasses.tenantId, p.tenantId)));

        // Mark member as checked in.
        await tx
          .update(groupMembers)
          .set({ checkedIn: true })
          .where(eq(groupMembers.id, member.id));
      }

      // Outbox: emit visitorCheckedIn for the group (single event, bulk).
      await enqueue(tx, {
        topic: EVENTS.visitorCheckedIn,
        eventType: EVENTS.visitorCheckedIn,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          groupVisitId: p.groupVisitId,
          membersCheckedIn: members.filter((m) => m.passId).length,
          headcountMatched: reconciliation.matched,
          discrepancyCount: reconciliation.discrepancyCount,
          gateId: p.gateId,
        },
      });
    });

    log.info(
      { tenantId: p.tenantId, groupVisitId: p.groupVisitId, actualHeadcount: p.actualHeadcount, event: "group_bulk_check_in" },
      "group bulk check-in processed",
    );
  });
}
