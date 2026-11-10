/**
 * UAT B24 group 3: the hourly document-alert cycle re-audited the same unchanged condition every
 * cycle (a Municipal Corporation contact still missing its PAN card: 23 identical audit rows in 24 h
 * per subject, ~1,100 a day on the UAT tenant, burying real activity in the audit trail). The
 * business event (crm.document.alert, which drives notifications) still fires every cycle; only the
 * audit row is limited to one per distinct alert per window.
 */
import { describe, it, expect } from "vitest";
import { AlertAuditDedupe } from "../src/modules/documents/alert-domain.js";

const TENANT = "8dcb509d-1a2e-41dc-8dbd-61a3a11b9d93";
const SUBJECT = "0bd0f7df-ac5a-4459-8082-eab3f0560c5b";
const HOUR = 3_600_000;

describe("AlertAuditDedupe", () => {
  it("audits an alert the first time and not again on the following hourly cycles", () => {
    const d = new AlertAuditDedupe(24 * HOUR);
    const t0 = new Date("2026-11-10T03:00:00Z");
    const key = { tenantId: TENANT, action: "document_alert_mandatory_missing", resourceId: SUBJECT, docTypeCode: "PAN" };
    expect(d.shouldAudit(key, t0)).toBe(true);
    for (let h = 1; h < 24; h++) expect(d.shouldAudit(key, new Date(t0.getTime() + h * HOUR))).toBe(false);
  });

  it("audits again once the window has passed (a still-open condition stays visible daily)", () => {
    const d = new AlertAuditDedupe(24 * HOUR);
    const t0 = new Date("2026-11-10T03:00:00Z");
    const key = { tenantId: TENANT, action: "document_alert_mandatory_missing", resourceId: SUBJECT, docTypeCode: "PAN" };
    d.shouldAudit(key, t0);
    expect(d.shouldAudit(key, new Date(t0.getTime() + 24 * HOUR))).toBe(true);
  });

  it("treats a different document type, action, subject or tenant as a different alert", () => {
    const d = new AlertAuditDedupe(24 * HOUR);
    const now = new Date("2026-11-10T03:00:00Z");
    const base = { tenantId: TENANT, action: "document_alert_mandatory_missing", resourceId: SUBJECT, docTypeCode: "PAN" };
    expect(d.shouldAudit(base, now)).toBe(true);
    expect(d.shouldAudit({ ...base, docTypeCode: "GST" }, now)).toBe(true);
    expect(d.shouldAudit({ ...base, action: "document_alert_expired" }, now)).toBe(true);
    expect(d.shouldAudit({ ...base, resourceId: "175b5be8-3339-41ee-b719-a335a4a5949b" }, now)).toBe(true);
    expect(d.shouldAudit({ ...base, tenantId: "67fc1140-0000-4000-8000-000000000001" }, now)).toBe(true);
    expect(d.shouldAudit(base, now)).toBe(false);
  });

  it("forgets expired entries so memory stays bounded", () => {
    const d = new AlertAuditDedupe(HOUR);
    const t0 = new Date("2026-11-10T03:00:00Z");
    for (let i = 0; i < 100; i++) d.shouldAudit({ tenantId: TENANT, action: "a", resourceId: `r${i}`, docTypeCode: null }, t0);
    expect(d.size).toBe(100);
    d.shouldAudit({ tenantId: TENANT, action: "a", resourceId: "new", docTypeCode: null }, new Date(t0.getTime() + 2 * HOUR));
    expect(d.size).toBe(1);
  });
});
