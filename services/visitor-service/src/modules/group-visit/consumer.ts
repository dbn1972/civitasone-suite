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
import { eq, and, inArray } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { groupVisits, groupMembers } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { visitRequests } from "../visit-request/schema.js";
import { generatePass, computeValidityWindow } from "../digital-pass/domain.js";
import { validateGroupSize, confirmBulkCheckIn } from "./domain.js";
import { getPolicyNumber, MS_PER_DAY } from "../config-registry/policy.js";
import { isBlacklisted } from "../blacklist/screening-store.js";
// BUG FIX (group bulk check-in bypassed the evacuation roster and check-in
// state machine): groupBulkCheckIn used to force-write digitalPasses.status
// = "checked_in" directly, skipping every protection the single-visitor
// check-in path (check-in/consumer.ts) enforces. Bring it to parity using
// the exact same building blocks that path uses.
import { checkIns } from "../check-in/schema.js";
import { locations } from "../location/schema.js";
import { checkIn as domainCheckIn, type CheckInStatus } from "../check-in/domain.js";
import { isOverCapacityThreshold } from "../location/domain.js";
import { addToRoster, getVisitorCount, type RosterEntry } from "../evacuation/roster.js";

const AUDIT_TOPIC = "audit.event.record";

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
      const multiDayMaxMs = (await getPolicyNumber(tx, p.tenantId, "digital_pass.multi_day_max_days")) * MS_PER_DAY;
      const recurringMaxMs = (await getPolicyNumber(tx, p.tenantId, "digital_pass.recurring_max_days")) * MS_PER_DAY;
      const { validFrom, validUntil } = computeValidityWindow(
        (p.passType as "single" | "multi_day" | "recurring" | "event") ?? "single",
        scheduledDate,
        p.passType !== "single" ? new Date(scheduledDate.getTime() + 24 * 60 * 60 * 1000) : undefined,
        { multiDayMaxMs, recurringMaxMs },
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
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "create", resourceType: "group_visit", resourceId: p.id, outcome: "success" } });
    });

    log.info(
      { tenantId: p.tenantId, groupVisitId: p.id, memberCount: p.members.length, event: "group_visit_created" },
      "group visit created with member passes",
    );
  });

  q.subscribe<GroupBulkCheckInPayload>(COMMANDS.groupBulkCheckIn, async (msg) => {
    const p = msg.payload;

    const committed = await db.transaction(async (tx): Promise<{
      locationId: string;
      capacityThreshold: number | null;
      checkedInMembers: Array<{ passId: string; visitorName: string; checkInTime: string }>;
    } | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

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

      // BUG FIX: read every member's CURRENT pass row (status + locationId)
      // BEFORE writing anything — the original handler never read
      // digital_passes at all, so it could silently reactivate an
      // individually-revoked pass. One bulk query, not N, to keep this a
      // single extra round-trip regardless of group size.
      const passIds = members.map((m) => m.passId).filter((id): id is string => id != null);
      const passRows = passIds.length > 0
        ? await tx
            .select()
            .from(digitalPasses)
            .where(and(inArray(digitalPasses.id, passIds), eq(digitalPasses.tenantId, p.tenantId)))
        : [];
      const passById = new Map(passRows.map((row) => [row.id, row]));

      const now = new Date();
      const checkedInMembers: Array<{ passId: string; visitorName: string; checkInTime: string }> = [];
      let locationId = "";

      for (const member of members) {
        if (!member.passId) continue;
        const pass = passById.get(member.passId);
        if (!pass) {
          log.warn(
            { tenantId: p.tenantId, groupVisitId: p.groupVisitId, memberId: member.id, passId: member.passId, event: "group_bulk_checkin_pass_not_found" },
            "group member's digital pass not found; skipping check-in for this member",
          );
          continue;
        }

        // BUG FIX: prior-status check — the SAME active|issued|checked_out ->
        // checked_in state machine the single check-in path uses
        // (check-in/consumer.ts). A member whose pass is e.g. "revoked" throws
        // here and is skipped, not silently reactivated. One bad member does
        // not fail the whole bulk operation, matching this handler's existing
        // per-member graceful-degradation convention (see pass-gen above).
        let nextStatus: "checked_in";
        try {
          nextStatus = domainCheckIn(pass.status as CheckInStatus, { passType: pass.passType as never });
        } catch (err) {
          log.warn(
            { err, tenantId: p.tenantId, groupVisitId: p.groupVisitId, passId: member.passId, currentStatus: pass.status, event: "group_bulk_checkin_invalid_status" },
            "group member's pass is not in a checkinable state; skipping rather than silently reactivating it",
          );
          continue;
        }

        // BUG FIX: audit insert — the single check-in path always records a
        // check_ins row; bulk check-in previously never did.
        await tx.insert(checkIns).values({
          tenantId: p.tenantId,
          passId: member.passId,
          locationId: pass.locationId,
          gateId: p.gateId ?? "",
          direction: "in",
          timestamp: now,
          verificationMethod: "bulk",
          createdBy: msg.actorId,
        });

        await tx
          .update(digitalPasses)
          .set({ status: nextStatus, updatedAt: now, updatedBy: msg.actorId })
          .where(and(eq(digitalPasses.id, member.passId), eq(digitalPasses.tenantId, p.tenantId)));

        // Mark member as checked in.
        await tx
          .update(groupMembers)
          .set({ checkedIn: true })
          .where(eq(groupMembers.id, member.id));

        checkedInMembers.push({ passId: member.passId, visitorName: member.memberName, checkInTime: now.toISOString() });
        locationId = locationId || pass.locationId;
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
          membersCheckedIn: checkedInMembers.length,
          headcountMatched: reconciliation.matched,
          discrepancyCount: reconciliation.discrepancyCount,
          gateId: p.gateId,
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "group_visit", resourceId: msg.messageId, outcome: "success" } });

      // Requirement 19.5 / Property 28 parity: resolve the location's
      // capacityThreshold now (inside the tx) so the post-commit check below
      // has it, same pattern as check-in/consumer.ts.
      const locationRows = locationId
        ? await tx
            .select({ capacityThreshold: locations.capacityThreshold })
            .from(locations)
            .where(and(eq(locations.id, locationId), eq(locations.tenantId, p.tenantId)))
            .limit(1)
        : [];

      return { locationId, capacityThreshold: locationRows[0]?.capacityThreshold ?? null, checkedInMembers };
    });

    if (!committed) return; // already processed (idempotent replay)

    // BUG FIX: evacuation roster — the single check-in path adds every
    // checked-in pass to the roster immediately after commit; bulk check-in
    // never did, so a whole group entering via this path was invisible to
    // the emergency evacuation headcount. Best-effort per member: never fail
    // an already-committed check-in because Redis is unavailable (same
    // graceful-degradation convention as check-in/consumer.ts).
    // Group visits do not currently collect a phone number per individual
    // member (only the lead visitor's), so contactNumber is left blank
    // rather than misattributing the lead's number to every member.
    for (const m of committed.checkedInMembers) {
      try {
        const entry: RosterEntry = {
          passId: m.passId,
          visitorName: m.visitorName,
          hostName: "",
          checkInTime: m.checkInTime,
          lastKnownGate: p.gateId ?? "",
          contactNumber: "",
          evacuated: false,
        };
        await addToRoster(p.tenantId, committed.locationId, entry);
      } catch (err) {
        log.warn(
          { err, tenantId: p.tenantId, passId: m.passId, event: "group_bulk_checkin_roster_add_failed" },
          "evacuation roster add failed for group member; check-in already committed, roster will self-heal on next check-in/out",
        );
      }
    }

    // BUG FIX: capacity-threshold check — same post-commit pattern as
    // check-in/consumer.ts, run once for the group using the final occupancy.
    try {
      if (committed.capacityThreshold != null && committed.checkedInMembers.length > 0) {
        const occupancy = await getVisitorCount(p.tenantId, committed.locationId);
        if (isOverCapacityThreshold(occupancy, committed.capacityThreshold)) {
          await db.transaction(async (tx) => {
            await enqueue(tx, {
              topic: EVENTS.capacityThresholdReached,
              eventType: EVENTS.capacityThresholdReached,
              tenantId: p.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: {
                locationId: committed.locationId,
                occupancy,
                capacityThreshold: committed.capacityThreshold,
              },
            });
            await enqueue(tx, {
              topic: NOTIFICATION_SEND,
              eventType: NOTIFICATION_SEND,
              tenantId: p.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: buildNotificationPayload({
                eventType: EVENTS.capacityThresholdReached,
                recipient: "security_control_room",
                channel: "push",
                variables: {
                  locationId: committed.locationId,
                  occupancy: String(occupancy),
                  capacityThreshold: String(committed.capacityThreshold),
                },
              }),
            });
          });
          log.info(
            { tenantId: p.tenantId, locationId: committed.locationId, occupancy, threshold: committed.capacityThreshold },
            "capacity threshold reached after group bulk check-in; alert dispatched",
          );
        }
      }
    } catch (err) {
      log.warn(
        { err, tenantId: p.tenantId, locationId: committed.locationId, event: "group_bulk_checkin_capacity_check_failed" },
        "capacity-threshold check failed after group bulk check-in; check-in already committed",
      );
    }

    log.info(
      { tenantId: p.tenantId, groupVisitId: p.groupVisitId, actualHeadcount: p.actualHeadcount, event: "group_bulk_check_in" },
      "group bulk check-in processed",
    );
  });
}
