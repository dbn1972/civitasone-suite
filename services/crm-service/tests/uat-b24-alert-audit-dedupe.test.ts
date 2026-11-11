/**
 * UAT B24 group 3: the hourly document-alert cycle re-audited the same unchanged condition every
 * cycle (a Municipal Corporation contact still missing its PAN card: 23 identical audit rows in 24 h
 * per subject, ~1,100 a day on the UAT tenant, burying real activity in the audit trail). The
 * business event (crm.document.alert, which drives notifications) still fires every cycle; only the
 * audit row is limited to one per distinct alert per window.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ audits: 0, failTx: false, txCalls: 0 }));
vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.txCalls += 1;
      const r = await fn({
        execute: async (q: { queryChunks?: unknown[] }) => {
          const text = JSON.stringify(q?.queryChunks ?? q);
          if (text.includes("document_types")) return [{ appliesTo: ["contact"], code: "PAN" }];
          if (text.includes("crm.contacts")) return [{ id: "0bd0f7df-ac5a-4459-8082-eab3f0560c5b" }];
          return [];
        },
      });
      if (h.failTx) throw new Error("commit failed");
      return r;
    },
  },
}));
vi.mock("../src/shared/scanner-db.js", () => ({ scannerSqlClient: () => Promise.resolve([]) }));
vi.mock("@civitasone/db", () => ({ runWithTenant: (_t: string, fn: () => unknown) => fn() }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, m: { topic: string }) => { if (m.topic === "audit.event.record") h.audits += 1; },
}));
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

  it("isDue does not record; record does", () => {
    const d = new AlertAuditDedupe(24 * HOUR);
    const now = new Date("2026-11-10T03:00:00Z");
    const key = { tenantId: TENANT, action: "document_alert_expired", resourceId: SUBJECT, docTypeCode: "PAN" };
    expect(d.isDue(key, now)).toBe(true);
    expect(d.isDue(key, now)).toBe(true);
    d.record(key, now);
    expect(d.isDue(key, now)).toBe(false);
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

describe("runTenantDocumentAlerts: dedupe is recorded only after commit", () => {
  const TENANT2 = "50021000-dead-4000-8000-0000005002a0";
  beforeEach(() => { h.audits = 0; h.failTx = false; });

  it("a transaction that throws leaves the alert unmarked, so the next cycle audits it", async () => {
    const { runTenantDocumentAlerts } = await import("../src/modules/documents/alert-scheduler.js");
    const now = new Date("2026-11-10T03:00:00Z");
    h.failTx = true;
    await expect(runTenantDocumentAlerts(TENANT2, now)).rejects.toThrow("commit failed");
    h.audits = 0; h.failTx = false;
    await runTenantDocumentAlerts(TENANT2, new Date(now.getTime() + HOUR));
    expect(h.audits).toBe(1); // not suppressed by the rolled-back attempt
    await runTenantDocumentAlerts(TENANT2, new Date(now.getTime() + 2 * HOUR));
    expect(h.audits).toBe(1); // committed once -> deduped afterwards
  });
});
