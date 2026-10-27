import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * W1 SF-01a grep guard (shared list-table rebuild). No non-test source file
 * under app/(app) may add:
 *   1. a raw `id.slice(0, 8)` -- show ids with `formatShortId()` from
 *      "@/lib/formatters" (UUIDs only are shortened; slug/code ids stay whole).
 *   2. a bare `<table className="tbl">` -- list pages belong on ModuleListPage /
 *      ModuleListTable (or the shared DataTable), which give sort, filter,
 *      paging, a mobile card layout and distinct error vs empty states.
 *
 * The two lists below are the files NOT yet migrated, all marked
 * "SF-01b follow-up". They may only SHRINK: when you fix a file, delete its
 * entry (the stale-entry test fails until you do). Do not add entries. This is
 * deliberately an allow-list in the test and NOT a baseline file.
 */
const APP_DIR = __dirname;

// SF-01b follow-up: files still using a raw id.slice(0, 8).
const ID_SLICE_ALLOW: readonly string[] = [
  "inventory/_labels.ts",
  "admin/bulk-scan/_components/LinksApprovals.tsx",
  "admin/bulk-scan/_components/SettingsForm.tsx",
  "ai/agents/AgentsTable.tsx",
  "ai/chat/ConversationsTable.tsx",
  "ai/guardrails/GuardrailRulesTable.tsx",
  "audit/exports/ExportsTable.tsx",
  "cdp/steward/StewardQueuePanel.tsx",
  "citizen/_data.ts",
  "crm/campaigns/[id]/page.tsx",
  "crm/health/[accountId]/page.tsx",
  "knowledge/repository/page.tsx",
  "knowledge/search/SearchClient.tsx",
  "notifications/templates/[id]/page.tsx",
  "policy/abac/page.tsx",
  "policy/bindings/page.tsx",
  "workflow/_components/InstancesTable.tsx",
];

// SF-01b follow-up: files still rendering a bare <table className="tbl">.
const BARE_TABLE_ALLOW: readonly string[] = [
  "admin/bulk-scan/_components/BatchDetail.tsx",
  "admin/bulk-scan/_components/BatchesList.tsx",
  "admin/bulk-scan/_components/LinksApprovals.tsx",
  "admin/bulk-scan/_components/NewBatchForm.tsx",
  "admin/bulk-scan/_components/ProfilesManager.tsx",
  "admin/bulk-scan/_components/ReviewQueue.tsx",
  "admin/bulk-scan/_components/ReviewWorkspace.tsx",
  "admin/platform/integrations/_components/PlatformIntegrationsClient.tsx",
  "admin/platform/integrations/_components/ProviderDrawer.tsx",
  "assets/bulk-import/page.tsx",
  "assets/leases/page.tsx",
  "change/[id]/page.tsx",
  "court/cases/[caseId]/CaseConsole.tsx",
  "court/hearings/page.tsx",
  "crm/health/[accountId]/page.tsx",
  "documents/inbox/page.tsx",
  "documents/library/page.tsx",
  "finance/opening-balances/OpeningBalanceForm.tsx",
  "hr/attendance/config/page.tsx",
  "hr/dpc/_components/SeniorityListActions.tsx",
  "hr/employees/import/page.tsx",
  "hr/payroll/comparison/page.tsx",
  "hr/payroll/pay-groups/MembershipDialogs.tsx",
  "hr/payroll/slips/[id]/page.tsx",
  "hr/payroll/tax-config/page.tsx",
  "inspection/assignments/page.tsx",
  "inspection/capa/page.tsx",
  "inspection/inspections/page.tsx",
  "meeting/meetings/[meetingId]/MeetingConsole.tsx",
  "meeting/meetings/[meetingId]/minutes/page.tsx",
  "meeting/meetings/page.tsx",
  "notifications/campaigns/_components/CampaignList.tsx",
  "procurement/planning/new/page.tsx",
  "procurement/rfq/[id]/ComparativeStatement.tsx",
  "procurement/tenders/[id]/TenderLifecycleActions.tsx",
  "procurement/tenders/[id]/documents/TenderDocumentsClient.tsx",
  "projects/[id]/members/page.tsx",
  "projects/[id]/risks/page.tsx",
  "projects/[id]/tasks/page.tsx",
  "tenant-admin/activation/ActivationView.tsx",
  "tenant-admin/platform-config/CacheTtlEditor.tsx",
  "tenant-admin/platform-config/page.tsx",
  "works/boq/[workId]/page.tsx",
];

const RAW_ID_SLICE = /\bid\.slice\(\s*0\s*,\s*8\s*\)/;
const BARE_TABLE = /className=("tbl"|\{"tbl"\})/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = walk(APP_DIR).map((p) => ({
  rel: relative(APP_DIR, p).split(sep).join("/"),
  text: readFileSync(p, "utf8"),
}));

function offenders(re: RegExp): string[] {
  return FILES.filter((f) => re.test(f.text)).map((f) => f.rel).sort();
}

describe("SF-01a list-table guard", () => {
  it("no NEW raw id.slice(0, 8) -- use formatShortId()", () => {
    const fresh = offenders(RAW_ID_SLICE).filter((f) => !ID_SLICE_ALLOW.includes(f));
    expect(fresh, "use formatShortId() from @/lib/formatters instead of id.slice(0, 8)").toEqual([]);
  });

  it("no NEW bare <table className=\"tbl\"> -- use ModuleListPage / ModuleListTable / DataTable", () => {
    const fresh = offenders(BARE_TABLE).filter((f) => !BARE_TABLE_ALLOW.includes(f));
    expect(fresh, "use ModuleListPage/ModuleListTable/DataTable instead of a bare tbl table").toEqual([]);
  });

  it("the id.slice allow-list only shrinks: remove entries that no longer offend", () => {
    const live = new Set(offenders(RAW_ID_SLICE));
    expect(ID_SLICE_ALLOW.filter((f) => !live.has(f))).toEqual([]);
  });

  it("the bare-table allow-list only shrinks: remove entries that no longer offend", () => {
    const live = new Set(offenders(BARE_TABLE));
    expect(BARE_TABLE_ALLOW.filter((f) => !live.has(f))).toEqual([]);
  });
});
