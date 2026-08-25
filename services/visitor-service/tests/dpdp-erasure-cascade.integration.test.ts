/**
 * DPDP right-to-erasure — CROSS-MODULE cascade audit.
 *
 * `processPurgeCycle` (src/modules/dpdp/purge-worker.ts) is the only code
 * path in this service that ever purges PII in response to an erasure
 * request or retention expiry, and its UPDATE statement targets exactly one
 * table: visitor.visit_requests (see purge-worker.ts:164-184). Nothing else
 * in the codebase references PURGED_SENTINEL or erasureRequestedAt — grep
 * confirms zero hits outside modules/dpdp/* and visit-request/schema.ts.
 *
 * But a single visitor's PII is NOT confined to visit_requests. It is
 * independently copied — often re-encrypted as its own column, not merely
 * referenced by FK — into at least four other tables reachable from the
 * same visit_request via the pass/group/scan graph:
 *
 *   - visitor.group_members.memberName / identityDocRef   (group-visit)
 *   - visitor.vehicle_passes.driverName                   (vehicle-pass)
 *   - visitor.print_jobs.renderedPayload                  (badge-print)
 *   - visitor.ocr_results.fullName / dateOfBirth /
 *            idDocumentNumber / address                   (document-scan)
 *
 * This test builds one visitor's realistic footprint across all of the
 * above (plus digital_passes / check_ins, which hold no PII of their own
 * but complete the graph) and runs the REAL processPurgeCycle against it,
 * exactly as dpdp-purge.integration.test.ts does for the single-table case.
 *
 * The first `it()` confirms the part that already works: visit_requests
 * itself is correctly purged. Every `it.fails()` below documents a
 * confirmed cascade gap — the assertion encodes the CORRECT DPDP behavior
 * (this other table's copy of the same PII should also be gone), and it
 * fails today because the bug is real. vitest's `.fails()` inverts pass/fail
 * so the suite stays green while the gap exists; the moment the cascade is
 * implemented, whichever of these starts unexpectedly passing should be
 * flipped to a plain `it()`.
 *
 * See the audit report for the full live before/after DB dump backing this
 * test (same fixture shape, run against the live wt-visitor-audit instance).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { scannerDb } from "../src/shared/scanner-db.js";
import { queue } from "../src/shared/infra.js";
import { registerDigitalPassConsumers } from "../src/modules/digital-pass/consumer.js";
import { processPurgeCycle, PURGED_SENTINEL } from "../src/modules/dpdp/purge-worker.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { devices } from "../src/modules/device-registry/schema.js";
import { groupVisits, groupMembers } from "../src/modules/group-visit/schema.js";
import { vehiclePasses } from "../src/modules/vehicle-pass/schema.js";
import { badgeTemplates, printJobs } from "../src/modules/badge-print/schema.js";
import { scanSessions, ocrResults } from "../src/modules/document-scan/schema.js";

const HOURS = 60 * 60_000;
const DAYS = 24 * HOURS;
const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

const TENANT = randomUUID();
const LOCATION_ID = randomUUID();
const GATE_ID = randomUUID();
const PRINTER_DEVICE_ID = randomUUID();
const SCANNER_DEVICE_ID = randomUUID();
const BADGE_TEMPLATE_ID = randomUUID();
const ACTOR = randomUUID();

const VISIT_REQUEST_ID = randomUUID();
const DIGITAL_PASS_ID = randomUUID();
const CHECK_IN_ID = randomUUID();
const GROUP_VISIT_ID = randomUUID();
const GROUP_MEMBER_ID = randomUUID();
const VEHICLE_PASS_ID = randomUUID();
const PRINT_JOB_ID = randomUUID();
const SCAN_SESSION_ID = randomUUID();
const OCR_RESULT_ID = randomUUID();

// The SAME visitor identity, deliberately reused verbatim across every
// table below — exactly how a real visitor's name/ID would appear
// consistently across their whole footprint in this system.
const VISITOR_NAME = "AUDIT-CascadeErasure Visitor";
const VISITOR_PHONE = "+919900099001";
const VISITOR_AADHAAR = "AUDIT-AADHAAR-CASCADE-0001";

let purgeResult: { purgedCount: number; purgedByTenant: Record<string, number> };

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION_ID, tenantId: TENANT, name: "AUDIT Cascade Loc",
        businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: GATE_ID, tenantId: TENANT, locationId: LOCATION_ID, name: "AUDIT Gate",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(devices).values([
        {
          id: PRINTER_DEVICE_ID, tenantId: TENANT, deviceType: "printer", name: "AUDIT Printer",
          serialNumber: "AUDIT-PRN-CASCADE-1", locationId: LOCATION_ID, authType: "bearer_token",
          createdBy: ACTOR, updatedBy: ACTOR,
        },
        {
          id: SCANNER_DEVICE_ID, tenantId: TENANT, deviceType: "scanner", name: "AUDIT Scanner",
          serialNumber: "AUDIT-SCN-CASCADE-1", locationId: LOCATION_ID, authType: "bearer_token",
          createdBy: ACTOR, updatedBy: ACTOR,
        },
      ]);
      await tx.insert(badgeTemplates).values({
        id: BADGE_TEMPLATE_ID, tenantId: TENANT, name: "AUDIT Cascade Template",
        printerLanguage: "zpl", templateBody: "^FD{{visitor_name}}^FS",
        createdBy: ACTOR, updatedBy: ACTOR,
      });

      // ── visit_requests: the row the purge worker actually knows about ──
      await tx.insert(visitRequests).values({
        id: VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION_ID,
        hostEmployeeId: ACTOR, status: "approved",
        visitorName: VISITOR_NAME, visitorPhone: VISITOR_PHONE,
        visitorEmail: "audit-cascade@example.test", identityDocType: "aadhaar",
        identityDocRef: VISITOR_AADHAAR,
        photoRef: "visitor-photos/audit-cascade-0001.jpg",
        createdBy: ACTOR, updatedBy: ACTOR,
      });

      // ── digital_passes / check_ins: no PII of their own, but complete
      // the same visitor's graph and let us confirm the pass is still live.
      await tx.insert(digitalPasses).values({
        id: DIGITAL_PASS_ID, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID,
        locationId: LOCATION_ID, passNumber: "AUDCASC1", passType: "single",
        qrJwt: "audit.fixture.jwt", validFrom: new Date(),
        validUntil: new Date(Date.now() + 24 * HOURS),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(checkIns).values({
        id: CHECK_IN_ID, tenantId: TENANT, passId: DIGITAL_PASS_ID,
        locationId: LOCATION_ID, gateId: GATE_ID, direction: "in", createdBy: ACTOR,
      });

      // ── group_members: an INDEPENDENT encrypted copy of the visitor's
      // name + Aadhaar ref, reachable via group_visits.visit_request_id.
      await tx.insert(groupVisits).values({
        id: GROUP_VISIT_ID, tenantId: TENANT, groupName: "AUDIT Cascade Group",
        memberCount: 2, purpose: "cascade audit repro", visitRequestId: VISIT_REQUEST_ID,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(groupMembers).values({
        id: GROUP_MEMBER_ID, tenantId: TENANT, groupVisitId: GROUP_VISIT_ID,
        memberName: VISITOR_NAME, identityDocType: "aadhaar",
        identityDocRef: VISITOR_AADHAAR, passId: DIGITAL_PASS_ID, createdBy: ACTOR,
      });

      // ── vehicle_passes: an INDEPENDENT encrypted copy of the visitor's
      // name as driverName, reachable via pass_id.
      await tx.insert(vehiclePasses).values({
        id: VEHICLE_PASS_ID, tenantId: TENANT, passId: DIGITAL_PASS_ID,
        locationId: LOCATION_ID, registrationNumber: "AUDIT-CASC-01",
        vehicleType: "car", visitorCategory: "standard", driverName: VISITOR_NAME,
        createdBy: ACTOR, updatedBy: ACTOR,
      });

      // ── print_jobs: the visitor's name baked into renderedPayload as
      // literal PLAINTEXT (not even encrypted-at-rest, unlike the others).
      await tx.insert(printJobs).values({
        id: PRINT_JOB_ID, tenantId: TENANT, deviceId: PRINTER_DEVICE_ID,
        passId: DIGITAL_PASS_ID, templateId: BADGE_TEMPLATE_ID, status: "completed",
        renderedPayload: `^FD${VISITOR_NAME}^FS`,
      });

      // ── ocr_results: an INDEPENDENT encrypted copy of name/DOB/ID-number/
      // address extracted from the scanned document, reachable via
      // scan_sessions (which has its own, unrelated, purely time-based
      // 1h image-cleanup worker that never touches this table).
      await tx.insert(scanSessions).values({
        id: SCAN_SESSION_ID, tenantId: TENANT, deviceId: SCANNER_DEVICE_ID, status: "completed",
      });
      await tx.insert(ocrResults).values({
        id: OCR_RESULT_ID, tenantId: TENANT, scanSessionId: SCAN_SESSION_ID,
        fullName: VISITOR_NAME, dateOfBirth: "1990-01-01",
        idDocumentNumber: VISITOR_AADHAAR, idDocumentType: "aadhaar",
        address: "AUDIT test address, cascade city", verificationStatus: "verified",
      });
    }),
  );

  // Request erasure: mark visit_requests.erasure_requested_at 80h in the
  // past, i.e. already past the 72h SLA — same convention as
  // dpdp-purge.integration.test.ts — then run the REAL purge cycle once.
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.update(visitRequests)
        .set({ erasureRequestedAt: new Date(Date.now() - 80 * HOURS) })
        .where(eq(visitRequests.id, VISIT_REQUEST_ID)),
    ),
  );

  // The cascade fix revokes any active digital pass for a purged visit
  // request by publishing digital-pass's own passRevoke() command (see
  // modules/dpdp/purge-worker.ts) rather than writing to digital_passes
  // directly — register the real digital-pass consumer on the shared
  // MemoryQueue so that command actually gets processed in this test.
  registerDigitalPassConsumers(queue);

  purgeResult = await processPurgeCycle(db, scannerDb, {
    retentionPeriodMs: 365 * DAYS,
    erasureSlaMs: 72 * HOURS,
    batchSize: 500,
  });

  // processPurgeCycle's post-commit pass-revocation is a fire-and-forget
  // queue.publish() (fixed to reuse passRevoke() per the file header) —
  // drain the in-process queue so the digital-pass consumer's DB write has
  // actually completed before the assertions below read digital_passes.
  await queue.drain();
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(ocrResults).where(eq(ocrResults.id, OCR_RESULT_ID));
      await tx.delete(scanSessions).where(eq(scanSessions.id, SCAN_SESSION_ID));
      await tx.delete(printJobs).where(eq(printJobs.id, PRINT_JOB_ID));
      await tx.delete(vehiclePasses).where(eq(vehiclePasses.id, VEHICLE_PASS_ID));
      await tx.delete(groupMembers).where(eq(groupMembers.id, GROUP_MEMBER_ID));
      await tx.delete(groupVisits).where(eq(groupVisits.id, GROUP_VISIT_ID));
      await tx.delete(checkIns).where(eq(checkIns.id, CHECK_IN_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, DIGITAL_PASS_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID));
      await tx.delete(badgeTemplates).where(eq(badgeTemplates.id, BADGE_TEMPLATE_ID));
      await tx.delete(devices).where(eq(devices.locationId, LOCATION_ID));
      await tx.delete(gates).where(eq(gates.id, GATE_ID));
      await tx.delete(locations).where(eq(locations.id, LOCATION_ID));
    }),
  );
});

describe("DPDP erasure cascade — one visitor's PII across module boundaries", () => {
  it("purges the owning visit_requests row (the one table the purge worker targets)", async () => {
    expect(purgeResult.purgedByTenant[TENANT] ?? 0).toBeGreaterThanOrEqual(1);

    const [vr] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID))),
    );
    expect(vr?.visitorName).toBe(PURGED_SENTINEL);
    expect(vr?.visitorPhone).toBe(PURGED_SENTINEL);
    expect(vr?.visitorEmail).toBeNull();
    expect(vr?.identityDocRef).toBeNull();
    expect(vr?.photoRef).toBeNull();
  });

  it("[FIXED] the erased visitor's digital pass is now revoked, not left active/scannable", async () => {
    // Previously erasure only ever touched visit_requests, so nothing
    // revoked the pass and the visitor's QR pass remained scannable/valid
    // for check-in at every gate even after their DPDP erasure request was
    // "processed". processPurgeCycle now publishes digital-pass's own
    // passRevoke() command (commands.ts) for any active pass on a purged
    // visit request; the real digital-pass consumer (registered above)
    // durably revokes it — see modules/dpdp/purge-worker.ts.
    const [pass] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, DIGITAL_PASS_ID))),
    );
    expect(pass?.status).toBe("revoked");
    expect(pass?.revoked).toBe(true);
  });

  it("[FIXED] group_members PII for the same visitor is purged too (group-visit)", async () => {
    const [gm] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(groupMembers).where(eq(groupMembers.id, GROUP_MEMBER_ID))),
    );
    expect(gm?.memberName).not.toBe(VISITOR_NAME);
    expect(gm?.identityDocRef).toBeNull();
  });

  it("[FIXED] vehicle_passes.driverName for the same visitor is purged too (vehicle-pass)", async () => {
    const [vp] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(vehiclePasses).where(eq(vehiclePasses.id, VEHICLE_PASS_ID))),
    );
    expect(vp?.driverName).not.toBe(VISITOR_NAME);
  });

  it("[FIXED] print_jobs.renderedPayload no longer has the visitor's name in PLAINTEXT (badge-print)", async () => {
    const [pj] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(printJobs).where(eq(printJobs.id, PRINT_JOB_ID))),
    );
    expect(pj?.renderedPayload ?? "").not.toContain(VISITOR_NAME);
  });

  it("[FIXED] ocr_results PII (name/DOB/ID-number/address) for the same visitor is purged too (document-scan)", async () => {
    const [ocr] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(ocrResults).where(eq(ocrResults.id, OCR_RESULT_ID))),
    );
    expect(ocr?.fullName).not.toBe(VISITOR_NAME);
    expect(ocr?.idDocumentNumber).toBeNull();
    expect(ocr?.dateOfBirth).toBeNull();
    expect(ocr?.address).toBeNull();
  });
});
