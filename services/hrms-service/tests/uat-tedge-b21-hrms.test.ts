/**
 * UAT T-EDGE bundle 21 -- HRMS forms (employee create, leave apply).
 *
 * TE-01: 29 Feb in a non-leap year / 31 Apr used to be HTTP 500 on employee create and leave
 * apply, and a 1e19 basic pay a 500 too; now a 400 with a field code. TE-03: end before start,
 * leave in 1990 / 2099 and a leave crossing the end of its allocation leave year are refused.
 * TE-05: Aadhaar (Verhoeff), IFSC, UAN, GSTIN checksum and mobile are checked; a valid Aadhaar is
 * stored MASKED. TE-06: whitespace-only name refused, employee number stored trimmed (so the
 * duplicate check cannot be side-stepped with spaces). TE-07: DOJ 1800 / 2999 and DOB after DOJ.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsLeaveTypes, hrmsLeaveAllocs } from "../src/modules/leave/schema.js";
import { allocationPeriod, allocationPeriodRefusal } from "../src/modules/leave/allocation-period.js";
import { istToday, addYears, addDays } from "@civitasone/schemas/validators";

const TENANT = randomUUID();
const ACTOR = randomUUID();
// vitest.config.ts injects JWT_SECRET for every suite -- never a literal here (gitleaks scans every commit).
const SECRET = process.env.JWT_SECRET as string;
const hdr = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}`, "content-type": "application/json" };
const deptId = randomUUID();
const desigId = randomUUID();
const empId = randomUUID();
const typeId = randomUUID();
const allocId = randomUUID();
const suffix = randomUUID().slice(0, 6);
const today = istToday();

let app: FastifyInstance;
const asTenant = <T>(fn: () => Promise<T>): Promise<T> => runWithTenant(TENANT, fn) as Promise<T>;
type Body = { code?: string; fieldErrors?: Array<{ field: string; code?: string }> };
const fieldCode = (b: Body, field: string) => b.fieldErrors?.find((f) => f.field === field)?.code;

const emp = (over: Record<string, unknown> = {}) => ({
  employeeNo: `TE-${suffix}-${randomUUID().slice(0, 4)}`, fullName: "UAT-TEDGE b21 employee", departmentId: deptId, designationId: desigId,
  dateOfJoining: addDays(today, -2), employeeType: "permanent", basicMinor: 0, ...over,
});
const leave = (over: Record<string, unknown> = {}) => ({
  employeeId: empId, leaveTypeId: typeId, allocId, fromDate: addDays(today, 30), toDate: addDays(today, 30), daysApplied: 1, reason: "UAT-TEDGE b21 leave", ...over,
});

beforeAll(async () => {
  await asTenant(() => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `B21-${suffix}`, name: "B21 Dept", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `B21-${suffix}`, name: "B21 Designation", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsEmployees).values({ id: empId, tenantId: TENANT, employeeNo: `B21-${suffix}`, fullName: "B21 Leave Holder", departmentId: deptId, designationId: desigId, dateOfJoining: "2020-01-01", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsLeaveTypes).values({ id: typeId, tenantId: TENANT, code: `B21${suffix.slice(0, 3)}`, name: "B21 Leave", maxDays: 30, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsLeaveAllocs).values({ id: allocId, tenantId: TENANT, employeeId: empId, leaveTypeId: typeId, fy: "2026-27", totalDays: 30, balanceDays: 30, createdBy: ACTOR, updatedBy: ACTOR });
  }));
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await asTenant(() => db.transaction(async (tx) => {
    await tx.delete(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.tenantId, TENANT));
    await tx.delete(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("POST /v1/hrms/employees -- refused with a field code, never a 500 (TE-01/05/06/07)", () => {
  it.each([
    ["E01 DOJ 2025-02-29", { dateOfJoining: "2025-02-29" }, "dateOfJoining", "DATE_INVALID"],
    ["E02 DOJ 2026-04-31", { dateOfJoining: "2026-04-31" }, "dateOfJoining", "DATE_INVALID"],
    ["E03 DOJ 1800-01-01", { dateOfJoining: "1800-01-01" }, "dateOfJoining", "DATE_TOO_EARLY"],
    ["E04 DOJ 2999-12-31", { dateOfJoining: "2999-12-31" }, "dateOfJoining", "DATE_TOO_LATE"],
    ["E05 DOB after DOJ", { dateOfBirth: "2030-01-01" }, "dateOfBirth", "DATE_ORDER"],
    ["DOB giving age 12", { dateOfBirth: addYears(today, -12) }, "dateOfBirth", "AGE_OUT_OF_RANGE"],
    ["E07 name of 4 spaces", { fullName: "    " }, "fullName", "TEXT_BLANK"],
    ["E12 IFSC ABCD1234567", { bankIfsc: "ABCD1234567" }, "bankIfsc", "IFSC_INVALID"],
    ["E13 UAN 12AB", { uanNumber: "12AB" }, "uanNumber", "UAN_INVALID"],
    ["E14 Aadhaar 1234", { aadhaarRef: "1234" }, "aadhaarRef", "AADHAAR_INVALID"],
    ["Aadhaar bad check digit", { aadhaarRef: "234123412347" }, "aadhaarRef", "AADHAAR_INVALID"],
    ["E15 GSTIN bad checksum", { gstin: "27AAPFU0939F1ZX" }, "gstin", "GSTIN_INVALID"],
    ["E17 mobile letters", { mobile: "abcdefghij" }, "mobile", "MOBILE_INVALID"],
    ["E23 basic 1e19", { basicMinor: 1e19 }, "basicMinor", "AMOUNT_TOO_LARGE"],
  ])("%s -> 400", async (_label, over, field, code) => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: hdr, payload: emp(over) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(fieldCode(res.json(), field)).toBe(code);
  });

  it("a valid employee is accepted: employee no trimmed (E09), Aadhaar stored masked, IFSC upper-cased, GSTIN control accepted (E25)", async () => {
    const employeeNo = `TE-${suffix}-E09`;
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/employees", headers: hdr,
      payload: emp({ employeeNo: `  ${employeeNo}  `, fullName: "  Asha Rao  ", aadhaarRef: "2341 2341 2346", bankIfsc: "sbin0001234", uanNumber: "100200300400", gstin: "27AAPFU0939F1ZV", mobile: "+91 9876543210", dateOfBirth: "1990-05-01" }),
    });
    expect(res.statusCode).toBe(202);
    const [row] = await asTenant(() => db.transaction((tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, res.json().id))));
    expect(row!.employeeNo).toBe(employeeNo);
    expect(row!.fullName).toBe("Asha Rao");
    expect(row!.aadhaarRef).toBe("XXXX-XXXX-2346");
    expect(row!.bankIfsc).toBe("SBIN0001234");
    // The duplicate check now sees the trimmed number: the same number with spaces is a 409.
    const dup = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: hdr, payload: emp({ employeeNo: ` ${employeeNo} ` }) });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("EMPLOYEE_NO_EXISTS");
  });
});

describe("POST /v1/hrms/leave-requests -- dates (TE-01/03/07)", () => {
  it.each([
    ["L01 from 2027-02-29", { fromDate: "2027-02-29", toDate: "2027-03-01" }, "fromDate", "DATE_INVALID"],
    ["L02 to 2027-04-31", { fromDate: "2027-04-30", toDate: "2027-04-31" }, "toDate", "DATE_INVALID"],
    ["L03 end before start", { fromDate: addDays(today, 40), toDate: addDays(today, 38), daysApplied: 1 }, "toDate", "DATE_ORDER"],
    ["L04 far past 1990", { fromDate: "1990-01-01", toDate: "1990-01-01" }, "fromDate", "DATE_TOO_EARLY"],
    ["L05 far future 2099", { fromDate: "2099-01-05", toDate: "2099-01-05" }, "fromDate", "DATE_TOO_LATE"],
  ])("%s -> 400", async (_label, over, field, code) => {
    for (const url of ["/v1/hrms/leave-requests", "/v1/hrms/leave-applications"]) {
      const res = await app.inject({ method: "POST", url, headers: hdr, payload: leave(over) });
      expect(res.statusCode, url).toBe(400);
      expect(fieldCode(res.json(), field), url).toBe(code);
    }
  });

  it("L06 31 Mar -> 1 Apr on the single 2026-27 allocation -> 422 LEAVE_OUTSIDE_ALLOCATION_PERIOD (not debited from one FY)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/leave-requests", headers: hdr, payload: leave({ fromDate: "2027-03-31", toDate: "2027-04-01", daysApplied: 2 }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("LEAVE_OUTSIDE_ALLOCATION_PERIOD");
    expect(res.json().message).toContain("2027-03-31");
  });

  it("the preview answers the same refusal as data", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/leave-requests/preview", headers: hdr, payload: leave({ fromDate: "2027-03-31", toDate: "2027-04-01", daysApplied: 2 }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().violations[0].code).toBe("LEAVE_OUTSIDE_ALLOCATION_PERIOD");
  });
});

describe("allocationPeriod (pure)", () => {
  it("reads FY and calendar leave-year labels", () => {
    expect(allocationPeriod("2026-27")).toEqual({ start: "2026-04-01", end: "2027-03-31", label: "2026-27" });
    expect(allocationPeriod("2027-CY")).toEqual({ start: "2027-01-01", end: "2027-12-31", label: "2027-CY" });
    expect(allocationPeriod("2026-28")).toBeNull();
    expect(allocationPeriod(null)).toBeNull();
  });
  it("refuses only a range outside the period", () => {
    expect(allocationPeriodRefusal("2026-27", "2026-04-01", "2027-03-31")).toBeNull();
    expect(allocationPeriodRefusal("2026-27", "2027-03-31", "2027-04-01")).toMatch(/after 2027-03-31/);
    expect(allocationPeriodRefusal("2027-CY", "2026-12-31", "2027-01-02")).toMatch(/before 2027-01-01/);
    expect(allocationPeriodRefusal("unknown", "2026-12-31", "2027-01-02")).toBeNull();
  });
});
