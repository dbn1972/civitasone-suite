import { eq, and, desc } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { measurementBooks, bills, measurements, accountCompilations } from "./schema.js";
import { workProposals } from "../proposal/schema.js";
import { awards } from "../tender/schema.js";

export async function getMb(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(measurementBooks)
      .where(and(eq(measurementBooks.id, id), eq(measurementBooks.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}

/** All measurement lines recorded against a given MB — the real, queryable
 * basis for a bill's "value of work actually measured". */
export async function listMeasurementsByMb(tenantId: string, mbId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(measurements)
      .where(and(eq(measurements.tenantId, tenantId), eq(measurements.mbId, mbId)));
  });
}

/** Every measurement recorded against a BoQ item, across all MBs — used to
 * enforce the cumulative FR-BIL-011 billing ceiling synchronously at the
 * route (see billing/routes.ts POST /measurements). */
export async function listMeasurementsByBoqItem(tenantId: string, boqItemId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(measurements)
      .where(and(eq(measurements.tenantId, tenantId), eq(measurements.boqItemId, boqItemId)));
  });
}

export async function getBill(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(bills)
      .where(and(eq(bills.id, id), eq(bills.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}

export async function listBillsForWork(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: bills.id,
        tenantId: bills.tenantId,
        workId: bills.workId,
        awardId: bills.awardId,
        mbId: bills.mbId,
        billMode: bills.billMode,
        billNumber: bills.billNumber,
        grossAmountMinor: bills.grossAmountMinor,
        deductionsMinor: bills.deductionsMinor,
        netPayableMinor: bills.netPayableMinor,
        status: bills.status,
        ifmsRef: bills.ifmsRef,
        submittedAt: bills.submittedAt,
        version: bills.version,
        createdBy: bills.createdBy,
        createdAt: bills.createdAt,
        // GAP-WORKS-BILLING-02: human-readable work reference for the detail
        // table (null when the work proposal row is absent).
        workNumber: workProposals.workNumber,
      })
      .from(bills)
      .leftJoin(workProposals, eq(workProposals.id, bills.workId))
      .where(and(eq(bills.tenantId, tenantId), eq(bills.workId, workId)));
  });
}

/**
 * Code-review fix (double-billing gap): every bill that already cites this
 * mbId — used to compute how much of the MB's measured value has already
 * been billed, so a second bill against the same MB can't independently
 * pass the same measured-value check the first one did.
 */
export async function listBillsByMb(tenantId: string, mbId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(bills)
      .where(and(eq(bills.tenantId, tenantId), eq(bills.mbId, mbId)));
  });
}

/** Tenant-wide bills register, newest first — backs the FE billing list page. */
export async function listBills(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: bills.id,
        tenantId: bills.tenantId,
        workId: bills.workId,
        awardId: bills.awardId,
        mbId: bills.mbId,
        billMode: bills.billMode,
        billNumber: bills.billNumber,
        grossAmountMinor: bills.grossAmountMinor,
        deductionsMinor: bills.deductionsMinor,
        netPayableMinor: bills.netPayableMinor,
        status: bills.status,
        ifmsRef: bills.ifmsRef,
        submittedAt: bills.submittedAt,
        version: bills.version,
        createdBy: bills.createdBy,
        createdAt: bills.createdAt,
        // GAP-WORKS-BILLING-02: human-readable work reference for the register.
        workNumber: workProposals.workNumber,
      })
      .from(bills)
      .leftJoin(workProposals, eq(workProposals.id, bills.workId))
      .where(eq(bills.tenantId, tenantId))
      .orderBy(desc(bills.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

/**
 * GAP-WORKS-BILLING-WORKID-04: measurement books issued for a work — backs the
 * FE MB finalize list (replaces the paste-a-UUID input). Newest first.
 */
export async function listMbsForWork(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: measurementBooks.id,
        workId: measurementBooks.workId,
        awardId: measurementBooks.awardId,
        mbNumber: measurementBooks.mbNumber,
        status: measurementBooks.status,
        issuedAt: measurementBooks.issuedAt,
        version: measurementBooks.version,
      })
      .from(measurementBooks)
      .where(and(eq(measurementBooks.tenantId, tenantId), eq(measurementBooks.workId, workId)))
      .orderBy(desc(measurementBooks.issuedAt));
  });
}

/**
 * GAP-WORKS-BILLING-BILLS-NEW-01 / NEW-MB-01: awards for a work — backs the FE
 * award picker on the Generate Bill / Issue MB forms (the Tenders list never
 * carried an award id). Only the columns the picker needs are selected.
 */
export async function listAwardsForWork(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: awards.id,
        workId: awards.workId,
        agreementNumber: awards.agreementNumber,
        contractorName: awards.contractorName,
        status: awards.status,
      })
      .from(awards)
      .where(and(eq(awards.tenantId, tenantId), eq(awards.workId, workId)))
      .orderBy(desc(awards.createdAt));
  });
}

/**
 * GAP-WORKS-BILLING-ACCOUNT-COMPILE-03: prior account compilations for a
 * month/year — lets the FE warn "already compiled on …" before a clerk
 * re-submits to treasury and risks a duplicate. Tenant-scoped, newest first.
 */
export async function listAccountCompilations(tenantId: string, month: number, year: number) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: accountCompilations.id,
        month: accountCompilations.month,
        year: accountCompilations.year,
        status: accountCompilations.status,
        submittedTo: accountCompilations.submittedTo,
        submittedAt: accountCompilations.submittedAt,
        dagRef: accountCompilations.dagRef,
      })
      .from(accountCompilations)
      .where(
        and(
          eq(accountCompilations.tenantId, tenantId),
          eq(accountCompilations.month, month),
          eq(accountCompilations.year, year),
        ),
      )
      .orderBy(desc(accountCompilations.year), desc(accountCompilations.month));
  });
}
