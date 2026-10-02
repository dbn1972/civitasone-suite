import { describe, it, expect } from "vitest";
import { canWrite, VENDOR_WRITE_ROLES, RECURRING_WRITE_ROLES } from "./writeRoles";

describe("canWrite", () => {
  it("hides vendor writes from readers the server would 403", () => {
    for (const r of ["finance_officer", "audit_officer", "procurement_officer"]) expect(canWrite([r], VENDOR_WRITE_ROLES)).toBe(false);
    expect(canWrite(["finance_admin"], VENDOR_WRITE_ROLES)).toBe(true);
  });
  it("recurring writes admit finance_officer but not auditors", () => {
    expect(canWrite(["finance_officer"], RECURRING_WRITE_ROLES)).toBe(true);
    expect(canWrite(["audit_officer"], RECURRING_WRITE_ROLES)).toBe(false);
  });
  it("does not hide when there is no role claim (server decides)", () => {
    expect(canWrite([], VENDOR_WRITE_ROLES)).toBe(true);
  });
});
