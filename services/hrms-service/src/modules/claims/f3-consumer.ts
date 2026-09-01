import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-claims" });

/** min() for paise amounts. Mirrors bmin() in ./routes.ts. */
function bmin(a: bigint, b: bigint): bigint { return a < b ? a : b; }

export function registerF3_claims_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "claims_routes__0",
      "claims_routes__1",
      "claims_routes__2",
      "claims_routes__3",
      "claims_routes__4",
      "claims_routes__5",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "claims_routes__0": {
            // F3 reconstruction: the code-gen that stubbed
            // POST /v1/hrms/ltc-claims/:claimId/approve down to publishF3Write(...)
            // dropped the setup that bound `claimId` (from req.params), `c` (the
            // claim fetched via mustLtc) and `approved` (the entitlement-capped
            // fare). All three survived in the repo.updateLtc call below but were
            // never declared here, so every LTC approval threw a ReferenceError
            // inside this consumer AFTER the route had already returned 200
            // "approved" — the claim silently stayed in 'submitted' forever.
            // `c.version` is also the optimistic-concurrency token updateLtc
            // requires, so it must come from a live read, not from the payload.
            const claimId = String(params.claimId ?? "");
            const c = await repo.findLtc(p.tenantId, claimId);
            if (!c) throw new Error(`LTC claim ${claimId} not found for tenant ${p.tenantId}`);
            // Ceiling enforcement, identical to routes.ts: approved fare cannot
            // exceed the entitlement.
            const approved = bmin(c.claimedFareMinor, c.entitlementMinor);
            await repo.updateLtc(tx, p.tenantId, claimId, {
                    status: "approved", approvedFareMinor: approved,
                    decidedAt: new Date(), decidedBy: msg.actorId,
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, c.version);
            break;
          }
          case "claims_routes__1": {
            // Same reconstruction as __0, for the LTC reject route: `claimId`
            // and the fetched claim `c` (needed for c.version) were undefined.
            const claimId = String(params.claimId ?? "");
            const c = await repo.findLtc(p.tenantId, claimId);
            if (!c) throw new Error(`LTC claim ${claimId} not found for tenant ${p.tenantId}`);
            await repo.updateLtc(tx, p.tenantId, claimId, {
                    status: "rejected", decidedAt: new Date(), decidedBy: msg.actorId,
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, c.version);
            break;
          }
          case "claims_routes__2": {
            // Same reconstruction as __0, for CEA approval. The cap here is the
            // per-child ANNUAL ceiling less what other submitted/approved claims
            // for the same child+kind+year have already committed — recomputed
            // via repo.ceaCommittedForChild exactly as routes.ts does.
            const claimId = String(params.claimId ?? "");
            const c = await repo.findCea(p.tenantId, claimId);
            if (!c) throw new Error(`CEA claim ${claimId} not found for tenant ${p.tenantId}`);
            const otherCommitted = await repo.ceaCommittedForChild(
              p.tenantId, c.employeeId, c.academicYear, c.childRef, c.claimKind, c.id);
            const remaining = c.annualCapMinor - otherCommitted;
            const approved = remaining <= 0n ? 0n : bmin(c.claimedAmountMinor, remaining);
            await repo.updateCea(tx, p.tenantId, claimId, {
                    status: "approved", approvedAmountMinor: approved,
                    decidedAt: new Date(), decidedBy: msg.actorId,
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, c.version);
            break;
          }
          case "claims_routes__3": {
            // Same reconstruction as __0, for the CEA reject route.
            const claimId = String(params.claimId ?? "");
            const c = await repo.findCea(p.tenantId, claimId);
            if (!c) throw new Error(`CEA claim ${claimId} not found for tenant ${p.tenantId}`);
            await repo.updateCea(tx, p.tenantId, claimId, {
                    status: "rejected", decidedAt: new Date(), decidedBy: msg.actorId,
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, c.version);
            break;
          }
          case "claims_routes__4": {
            const employeeId = String(params.id ?? "");
            await repo.insertLtc(tx, {
              id,
              tenantId: p.tenantId,
              employeeId,
              blockYear: body.blockYear,
              ltcType: body.ltcType,
              journeyFrom: body.journeyFrom,
              journeyTo: body.journeyTo,
              travelDate: body.travelDate,
              familyMembers: Number(body.familyMembers ?? 1),
              claimedFareMinor: BigInt(body.claimedFareMinor ?? 0),
              entitlementMinor: BigInt(body.entitlementMinor ?? 0),
              status: "submitted",
              ...(body.remarks ? { remarks: body.remarks } : {}),
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            break;
          }
          case "claims_routes__5": {
            const employeeId = String(params.id ?? "");
            await repo.insertCea(tx, {
              id,
              tenantId: p.tenantId,
              employeeId,
              academicYear: body.academicYear,
              childName: body.childName,
              childRef: body.childRef,
              claimKind: body.claimKind,
              claimedAmountMinor: BigInt(body.claimedAmountMinor ?? 0),
              annualCapMinor: BigInt(body.annualCapMinor ?? 0),
              status: "submitted",
              ...(body.remarks ? { remarks: body.remarks } : {}),
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
