/**
 * inspection-service: assignment module — SQS/RabbitMQ consumer.
 *
 * Handles inspector assignment, tour plan generation, and geo-attendance commands:
 *   - inspectorAssign: validate competency + conflict + capacity → insert → emit event → notify
 *   - tourPlanGenerate: fetch leave from hrms-service (circuit breaker) → group by geo → create slots
 *   - geoAttendanceMark: validate geofence → store record → flag mismatch → notify supervisor
 *
 * All handlers follow the idempotency pattern:
 *   markProcessed(tx, msg.messageId) → write → enqueue event → cache invalidate
 *
 * HRMS integration uses @civitasone/circuit-breaker:
 *   - 10s timeout per call
 *   - 5 consecutive failures → breaker trips to open
 *   - 30s cooldown before half-open probe
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
 */
import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import {
  validateCompetency,
  checkConflictOfInterest,
  validateDailyCapacity,
  validateGeofence,
  DomainError,
} from "./domain.js";
import * as repo from "./repo.js";
import type {
  InspectorAssignPayload,
  TourPlanGeneratePayload,
  GeoAttendanceMarkPayload,
} from "./commands.js";

const log = pino({ name: "assignment-consumer" });

const AUDIT_TOPIC = "audit.event.record";

// ── Consumed Event Payload Types ──────────────────────────────────────────────

/**
 * Payload shape for hrms.leave.updated events published by hrms-service.
 * Cross-service contract: { employeeId, tenantId, leaveType, startDate, endDate, status }
 */
interface EmployeeLeaveUpdatedPayload {
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
}

// ── HRMS Circuit Breaker ──────────────────────────────────────────────────────

const hrmsCircuitBreaker = new CircuitBreaker({
  name: "hrms-service",
  failureThreshold: 5,
  recoveryMs: 30_000, // 30s cooldown
});

const HRMS_TIMEOUT_MS = 10_000; // 10s timeout

/** Fetch inspector leave schedule from hrms-service with circuit breaker + timeout. */
async function fetchInspectorLeave(
  tenantId: string,
  inspectorId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Array<{ startDate: string; endDate: string }>> {
  const hrmsBaseUrl = process.env.HRMS_SERVICE_URL ?? "http://localhost:3012";
  const url = `${hrmsBaseUrl}/v1/hrms/leave?employeeId=${inspectorId}&startDate=${periodStart}&endDate=${periodEnd}`;

  return hrmsCircuitBreaker.call(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HRMS_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
        },
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`HRMS responded with status ${resp.status}`);
      }

      const body = (await resp.json()) as { data: Array<{ startDate: string; endDate: string }> };
      return body.data ?? [];
    } finally {
      clearTimeout(timeout);
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get all dates between two ISO date strings (inclusive). */
function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    dates.push(current.toISOString().split("T")[0]!);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Check if a date falls within any leave period. */
function isLeaveDay(
  date: string,
  leavePeriods: Array<{ startDate: string; endDate: string }>,
): boolean {
  return leavePeriods.some((leave) => date >= leave.startDate && date <= leave.endDate);
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerAssignmentConsumers(queue: Queue): void {
  // ─── inspectorAssign ──────────────────────────────────────────────────
  queue.subscribe<InspectorAssignPayload>(COMMANDS.inspectorAssign, async (msg) => {
    const p = msg.payload;
    let assignmentId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // 1. Fetch inspector capacity (competencies + daily limit)
      const capacity = await repo.findCapacity(msg.tenantId, p.inspectorId);
      if (!capacity) {
        throw new NonRetryableError(
          `No capacity record found for inspector ${p.inspectorId}`,
        );
      }

      // 2. Validate competency — inspector must hold all required competencies
      const requiredCompetencies = p.competencies ?? [];
      if (requiredCompetencies.length > 0) {
        try {
          validateCompetency(
            capacity.competencies as string[],
            requiredCompetencies,
          );
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }
      }

      // 3. Check conflict of interest (unless bypassed)
      if (!p.conflictCheckBypass) {
        const conflicts = await repo.findConflicts(msg.tenantId, p.inspectorId);
        try {
          checkConflictOfInterest(
            conflicts.map((c) => ({ entityId: c.entityId, relationshipType: c.relationshipType })),
            p.entityId,
          );
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }
      }

      // 4. Validate daily capacity
      const dailyCount = await repo.countDailyAssignments(
        msg.tenantId,
        p.inspectorId,
        p.scheduledDate,
      );
      try {
        validateDailyCapacity(dailyCount, capacity.dailyLimit);
      } catch (err) {
        if (err instanceof DomainError) {
          throw new NonRetryableError(err.message);
        }
        throw err;
      }

      // 5. Insert assignment
      const assignment = await repo.insertAssignment(tx, {
        tenantId: msg.tenantId,
        inspectionId: p.inspectionId,
        inspectorId: p.inspectorId,
        inspectionTypeId: p.inspectionTypeId,
        entityId: p.entityId,
        scheduledDate: p.scheduledDate,
        status: "assigned",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      assignmentId = assignment.id;

      // 6. Emit inspectorAssigned domain event via outbox
      await enqueue(tx, {
        topic: EVENTS.inspectorAssigned,
        eventType: EVENTS.inspectorAssigned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          inspectionId: p.inspectionId,
          inspectorId: p.inspectorId,
          assignedBy: msg.actorId,
          competencies: capacity.competencies,
        },
      });

      // 7. Publish notification to notify inspector (Req 4.7)
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "inspection.inspector.assigned",
          recipient: p.inspectorId,
          recipientId: p.inspectorId,
          channel: "in_app",
          variables: {
            inspectionId: p.inspectionId,
            scheduledDate: p.scheduledDate,
          },
        }),
      });

      // 8. Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "inspector.assigned",
          resourceType: "inspection_assignment",
          resourceId: assignment.id,
          details: {
            inspectionId: p.inspectionId,
            inspectorId: p.inspectorId,
            scheduledDate: p.scheduledDate,
          },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (assignmentId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "assignment", assignmentId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, assignmentId, event: "cache_invalidate_failed" },
          "failed to invalidate assignment cache after create");
      }
    }
  });

  // ─── tourPlanGenerate ─────────────────────────────────────────────────
  queue.subscribe<TourPlanGeneratePayload>(COMMANDS.tourPlanGenerate, async (msg) => {
    const p = msg.payload;
    let tourPlanId: string | undefined;

    // Fetch leave from HRMS (outside transaction — external call)
    let leavePeriods: Array<{ startDate: string; endDate: string }> = [];
    try {
      leavePeriods = await fetchInspectorLeave(
        msg.tenantId,
        p.inspectorId,
        p.periodStart,
        p.periodEnd,
      );
    } catch (err) {
      if (err instanceof CircuitBreakerOpenError) {
        log.warn(
          { event: "hrms_circuit_breaker_open", inspectorId: p.inspectorId, tenantId: msg.tenantId },
          "HRMS circuit breaker is open — generating tour plan without leave data",
        );
      } else {
        log.warn(
          { err, event: "hrms_leave_fetch_failed", inspectorId: p.inspectorId, tenantId: msg.tenantId },
          "failed to fetch leave from HRMS — generating tour plan without leave data",
        );
      }
      // Graceful degradation: proceed without leave data
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Generate available dates (excluding leave days)
      const allDates = getDateRange(p.periodStart, p.periodEnd);
      const availableDates = allDates.filter((d) => !isLeaveDay(d, leavePeriods));

      // Group inspections by geo proximity for slot creation.
      // For now, create one slot per available date up to max daily inspections.
      const maxDaily = p.maxDailyInspections ?? 4;
      const slots: Array<{ date: string; slotIndex: number }> = [];

      for (const date of availableDates) {
        for (let i = 0; i < maxDaily; i++) {
          slots.push({ date, slotIndex: i });
        }
      }

      // Insert tour plan
      const plan = await repo.insertTourPlan(tx, {
        tenantId: msg.tenantId,
        inspectorId: p.inspectorId,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        slots,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      tourPlanId = plan.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "tour_plan.generated",
          resourceType: "tour_plan",
          resourceId: plan.id,
          details: {
            inspectorId: p.inspectorId,
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
            totalSlots: slots.length,
            leaveDaysExcluded: allDates.length - availableDates.length,
          },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (tourPlanId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "tour_plan", p.inspectorId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, tourPlanId, event: "cache_invalidate_failed" },
          "failed to invalidate tour_plan cache after generate");
      }
    }

    log.info(
      { event: "tour_plan_generated", tourPlanId, inspectorId: p.inspectorId, tenantId: msg.tenantId },
      "tour plan generated",
    );
  });

  // ─── geoAttendanceMark ────────────────────────────────────────────────
  queue.subscribe<GeoAttendanceMarkPayload>(COMMANDS.geoAttendanceMark, async (msg) => {
    const p = msg.payload;
    let attendanceId: string | undefined;
    let locationMismatch = false;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Validate geofence — compute haversine distance and check against radius
      const geofenceResult = validateGeofence(
        parseFloat(p.latitude),
        parseFloat(p.longitude),
        parseFloat(p.entityLatitude),
        parseFloat(p.entityLongitude),
        p.geofenceRadius,
      );

      locationMismatch = geofenceResult.locationMismatch;

      // Insert geo-attendance record
      const record = await repo.insertGeoAttendance(tx, {
        tenantId: msg.tenantId,
        inspectionId: p.inspectionId,
        inspectorId: p.inspectorId,
        latitude: p.latitude,
        longitude: p.longitude,
        entityLatitude: p.entityLatitude,
        entityLongitude: p.entityLongitude,
        distanceMeters: geofenceResult.distanceMeters,
        geofenceRadius: p.geofenceRadius,
        locationMismatch: geofenceResult.locationMismatch ? 1 : 0,
        createdBy: msg.actorId,
      });

      attendanceId = record.id;

      // If location mismatch, notify supervisor (Req 4.6)
      if (geofenceResult.locationMismatch) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: "inspection.geo_attendance.mismatch",
            recipient: msg.actorId, // supervisor who initiated the assignment
            channel: "in_app",
            variables: {
              inspectorId: p.inspectorId,
              inspectionId: p.inspectionId,
              distanceMeters: String(geofenceResult.distanceMeters),
              geofenceRadius: String(p.geofenceRadius),
            },
          }),
        });
      }

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "geo_attendance.marked",
          resourceType: "geo_attendance",
          resourceId: record.id,
          details: {
            inspectionId: p.inspectionId,
            inspectorId: p.inspectorId,
            distanceMeters: geofenceResult.distanceMeters,
            locationMismatch: geofenceResult.locationMismatch,
          },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (attendanceId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "geo_attendance", attendanceId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, attendanceId, event: "cache_invalidate_failed" },
          "failed to invalidate geo_attendance cache after mark");
      }
    }

    log.info(
      {
        event: "geo_attendance_marked",
        attendanceId,
        inspectorId: p.inspectorId,
        locationMismatch,
        tenantId: msg.tenantId,
      },
      "geo-attendance recorded",
    );
  });

  // ─── employeeLeaveUpdated (CONSUMED EVENT from hrms-service) ──────────
  // When an employee's leave changes, invalidate any cached tour plans for
  // that inspector so subsequent tour plan generation picks up the new data.
  // Requirement 4.4: Tour plans respect inspector leave and existing commitments.
  queue.subscribe<EmployeeLeaveUpdatedPayload>(CONSUMED_EVENTS.employeeLeaveUpdated, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Invalidate the inspector's tour plan cache so the next generation
      // uses fresh leave data from HRMS.
      log.info(
        {
          event: "employee_leave_updated",
          employeeId: p.employeeId,
          leaveType: p.leaveType,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.status,
          tenantId: msg.tenantId,
        },
        "received leave update from hrms-service — invalidating tour plan cache",
      );

      // Audit event: record the consumed cross-service event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: p.employeeId,
        correlationId: msg.correlationId,
        payload: {
          action: "leave.updated_received",
          resourceType: "tour_plan",
          resourceId: p.employeeId,
          details: {
            leaveType: p.leaveType,
            startDate: p.startDate,
            endDate: p.endDate,
            status: p.status,
          },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, "tour_plan", p.employeeId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, employeeId: p.employeeId, event: "cache_invalidate_failed" },
        "failed to invalidate tour_plan cache after leave update");
    }
  });
}
