/**
 * CLOS2-S3-10: these offline "saved data from ..." banners / delivery cells must
 * format instants in IST via formatDateTimeIST, never the viewer's zone via
 * `new Date(x).toLocaleString("en-IN")`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "..", "app", "(app)");
const FILES = [
  "telephony/calls/page.tsx",
  "telephony/dispositions/page.tsx",
  "telephony/agents/page.tsx",
  "telephony/_components/TelephonyLiveSummary.tsx",
  "procurement/approvals/ProcurementApprovalsPanel.tsx",
  "projects/beneficiaries/BeneficiariesTable.tsx",
  "projects/delay-analysis/DelayAnalysisTable.tsx",
  "projects/dpr-tracking/DprTrackingTable.tsx",
  "tenant-admin/webhooks/WebhooksClient.tsx",
];

describe("IST date display (CLOS2-S3-10)", () => {
  it.each(FILES)("%s formats instants with formatDateTimeIST", (f) => {
    const src = readFileSync(join(APP, f), "utf8");
    expect(src).not.toMatch(/new Date\([^()]*\)\.toLocaleString\("en-IN"\)/);
    expect(src).toContain("formatDateTimeIST(");
  });
});
