import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as glRepo from "../gl/repo.js";
import { fetchUserNames } from "../../shared/identity-client.js";
import { pino } from "pino";
import { sanctionAvailable, effectiveHeadType, isKnownSanctionStatus, mapSanctionStatus as domainMapSanctionStatus, type SanctionWebStatus } from "./domain.js";
import type { BudgetRow, SanctionRow } from "./schema.js";

/**
 * GAP2-FINANCE-SANCTIONS-OFFICER-01: shown as "Sanctioned By" when the
 * sanction's creator id cannot be resolved to a real identity-service user
 * (unreachable service, or a user no longer present). A neutral honest label,
 * never a raw-UUID-derived token presented as the authoritative officer.
 */
const UNKNOWN_OFFICER = "Unknown officer";


/**
 * Convert paise (bigint) to a major-unit string for JSON serialization.
 * Uses string-based division so amounts above 2^53 paise (≈ Rs 90 crore)
 * don't lose precision — critical for government budgets.
 */
function minorToAmount(minor: bigint | number | string | null | undefined): number {
  const m = BigInt(minor ?? 0);
  // For amounts under 2^53 (Rs 90 crore), Number is exact.
  // For larger amounts, this still truncates — but the API returns the raw
  // string field too (amountMinor) so the frontend can format safely.
  return Number(m) / 100;
}

const sanctionLog = pino({ name: "finance-budget-queries" });

/** domain mapSanctionStatus + a warning for a stored status it does not know. */
function mapSanctionStatus(status: string): SanctionWebStatus {
  if (!isKnownSanctionStatus(status)) sanctionLog.warn({ status }, "unknown sanction status mapped to pending");
  return domainMapSanctionStatus(status);
}

export type AccountListItem = {
  id: string;
  code: string;
  hoaCode: string | null;
  name: string;
  /** 0 = major, 1 = minor, 2 = sub-minor */
  level: number;
  parentId: string | null;
  /** Sub-ledger-controlled account: not postable from a manual journal. */
  isControl: boolean;
  /** True when no other head hangs under this one: only a leaf (detail) account is postable. */
  isLeaf: boolean;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  currency: string;
  balanceDisplay: string;
  status: "active" | "inactive";
};

function mapAccountType(classification: string | null, code: string): AccountListItem["type"] {
  return effectiveHeadType(classification, code);
}

/**
 * BUG FIX (Medium finding, Chart of Accounts stale/zero figures): balances
 * were unconditionally hardcoded to "0" here regardless of real posted
 * ledger activity -- not a cache-staleness issue, the query never read
 * gl.finance_ledger at all. Standard double-entry sign convention: asset/
 * expense heads carry a normal DEBIT balance (debit increases them), so
 * their displayed balance is debit minus credit; liability/equity/income
 * heads carry a normal CREDIT balance, so theirs is credit minus debit. A
 * head with zero ledger rows (no `bal` entry) is a genuine zero balance,
 * not a data gap, so `0n` defaults are correct here (unlike the dashboard's
 * own budgetUtilisationPct null-vs-zero distinction, which is about an
 * entirely absent BUDGET record, not an absent transaction).
 */
function computeBalanceMinor(
  type: AccountListItem["type"],
  totalDebit: bigint,
  totalCredit: bigint,
): bigint {
  return type === "asset" || type === "expense" ? totalDebit - totalCredit : totalCredit - totalDebit;
}

/**
 * Bigint-safe rupee/paise split + Indian lakh/crore digit grouping, without
 * a currency symbol. AccountsTable.tsx (Chart of Accounts) already prepends
 * its own "₹" (`render: (a) => <>₹{a.balanceDisplay}</>`), so balanceDisplay
 * itself must stay symbol-free, matching the plain-digit contract its
 * previous hardcoded "0" already had. Same algorithm as payments/queries.ts's
 * formatMinor, kept local (one character of difference -- no "₹") rather
 * than exported across modules for reuse.
 */
function formatBalanceMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const rupees = abs / 100n;
  const paise = abs % 100n;
  const rupeesStr = rupees.toString();
  const grouped = rupeesStr.length <= 3
    ? rupeesStr
    : rupeesStr.slice(0, rupeesStr.length - 3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + rupeesStr.slice(-3);
  return `${negative ? "-" : ""}${grouped}.${paise.toString().padStart(2, "0")}`;
}

export async function listAccounts(tenantId: string, limit: number, search?: string): Promise<AccountListItem[]> {
  const term = search?.trim() || undefined;
  const load = async (): Promise<AccountListItem[]> => {
    const [heads, balanceRows, parentIds] = await Promise.all([
      repo.listHeads(tenantId, limit, term),
      glRepo.getTrialBalance(tenantId),
      repo.listParentHeadIds(tenantId),
    ]);
    const balanceByHead = new Map(balanceRows.map((b) => [b.headId, b]));
    return heads.map((h) => {
      const type = mapAccountType(h.classification, h.code);
      const bal = balanceByHead.get(h.id);
      const balanceMinor = computeBalanceMinor(type, bal?.totalDebit ?? 0n, bal?.totalCredit ?? 0n);
      return {
        id: h.id,
        code: h.code,
        hoaCode: h.hoaCode ?? null,
        name: h.name,
        // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02: hierarchy placement, so the
        // create form can offer only heads one level up as a parent.
        level: h.level,
        parentId: h.parentId ?? null,
        isControl: h.isControl === true,
        isLeaf: !parentIds.has(h.id),
        type,
        currency: "INR",
        balanceDisplay: formatBalanceMinor(balanceMinor),
        status: "active" as const,
      };
    });
  };
  // A search (GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-04) is a one-off lookup and is
  // never cached: account writes invalidate only the plain `list:<limit>` key.
  const rows = term
    ? await load()
    : await cache.getOrLoad(cache.makeKey(tenantId, "accounts", `list:${limit}`), load, 60);
  return rows ?? [];
}

export async function getBudget(tenantId: string, headId: string, fy: string): Promise<BudgetRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "budget", `${headId}:${fy}`),
    () => repo.findBudget(headId, fy, tenantId)
  );
}

export async function listBudgetSummaries(tenantId: string, limit: number, offset = 0) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "budgets", `list:${limit}:${offset}`),
    () => repo.listBudgetsByTenant(tenantId, limit, offset),
    60,
  );
  const headIds_b = [...new Set((rows ?? []).map((r) => r.headId))];
  const headList_b = await repo.findHeadsByIds(headIds_b);
  const headMap_b = new Map(headList_b.map((h) => [h.id, h]));
  const summaries = [];
  for (const row of rows ?? []) {
    const head = headMap_b.get(row.headId);
    // H3: keep as bigint throughout to avoid 2^53 precision loss on large budgets.
    //
    // FIX (HIGH: list always reported allocated/balance as 0 and status
    // "exhausted"): financeBudgets.allocatedMinor is hard-coded to 0n at
    // creation (consumer.ts's budgetCreate) and is never written by any
    // other write path in this service — re-appropriation only ever touches
    // re_minor (repo.transferBudgetReMinorGuarded) and supplementary-demand
    // approval only ever touches be_minor/re_minor
    // (supplementary-repo.applySupplementaryToBudget). Because 0n is not
    // nullish, `row.allocatedMinor ?? row.beMinor` never fell through to
    // beMinor, so "allocated" silently read 0 for every budget here,
    // regardless of real utilisation.
    //
    // re_minor (Revised Estimate) is the domain's real authoritative
    // "currently sanctioned" figure: it starts equal to be_minor at
    // creation, is raised by supplementary-demand approval, and is
    // debited/credited by re-appropriation transfers — and it's already
    // what the real spend-gating logic trusts (repo.ts's
    // incrementBudgetUtilisedGuarded and domain.ts's
    // assertReappropriationValid both gate on `re_minor - utilised_minor`,
    // never on allocatedMinor). So "allocated" is derived from re_minor here
    // instead of the dead allocated_minor column.
    const allocated = row.reMinor ?? row.beMinor ?? 0n;
    const utilised = row.utilisedMinor ?? 0n;
    summaries.push({
      id: row.id,
      majorHead: head?.code ?? row.headId,
      subHead: head?.name,
      // H3: return paise amounts as strings; frontend divides by 100 for display.
      sanctionedAmount: allocated.toString(),
      // No separate "released/disbursed tranche" concept is tracked in this
      // schema — releasedAmount previously faked one via min(reMinor,
      // allocated) against the dead allocatedMinor column. Now that
      // "allocated" IS re_minor, that min() would just compare re_minor to
      // itself, so report the current sanctioned figure directly.
      releasedAmount: allocated.toString(),
      expenditure: utilised.toString(),
      balance: (allocated > utilised ? allocated - utilised : 0n).toString(),
      // Raw BE/RE so consumers needing genuine BE-vs-RE variance — where RE
      // can legitimately exceed BE before a supplementary grant reconciles
      // it — have it (reMinor here now equals "allocated" above).
      beMinor: (row.beMinor ?? 0n).toString(),
      reMinor: allocated.toString(),
      status: utilised >= allocated ? "exhausted" : "active",
      financialYear: row.fy,
    });
  }
  return summaries;
}

export async function getSanctionAvailable(id: string, tenantId: string): Promise<{ id: string; available: bigint; currency: string } | null> {
  const sanction = await cache.getOrLoad<SanctionRow>(
    cache.makeKey(tenantId, "sanction", id),
    () => repo.findSanctionByIdAndTenant(id, tenantId)
  );
  // Tenant isolation: reject if DB row belongs to a different tenant (defence after cache miss).
  if (!sanction || sanction.tenantId !== tenantId) return null;
  return {
    id,
    available: sanctionAvailable({ amountMinor: sanction.amountMinor, utilisedMinor: sanction.utilisedMinor }),
    currency:  sanction.currency ?? "INR",
  };
}

export async function listSanctionSummaries(tenantId: string, limit: number, offset = 0) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "sanctions", `list:${limit}:${offset}`),
    () => repo.listSanctionsByTenant(tenantId, limit, offset),
    60,
  );
  const headIds_s = [...new Set((rows ?? []).map((r) => r.headId))];
  const headList_s = await repo.findHeadsByIds(headIds_s);
  const headMap_s = new Map(headList_s.map((h) => [h.id, h]));
  // GAP2-FINANCE-SANCTIONS-OFFICER-01: resolve the creator id to a real
  // display name via identity-service (batched, fail-OPEN to an honest
  // "Unknown officer"), never a raw-UUID-derived token.
  const officerNames = await fetchUserNames(tenantId, (rows ?? []).map((r) => r.createdBy));
  const summaries = [];
  for (const row of rows ?? []) {
    const head = headMap_s.get(row.headId);
    summaries.push({
      id: row.id,
      sanctionNo: row.sanctionNo,
      subject: row.purpose,
      // H3: string to avoid 2^53 precision loss on large government sanction amounts.
      amount: row.amountMinor.toString(),
      sanctionedBy: officerNames.get(row.createdBy) ?? UNKNOWN_OFFICER,
      date: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
      status: mapSanctionStatus(row.status),
      majorHead: head?.code ?? row.headId,
    });
  }
  return summaries;
}

export type SanctionsSummary = {
  total: number;
  active: number;
  pending: number;
  approved: number;
  /** Bigint-safe paise string: SUM over APPROVED sanctions only. */
  approvedMinor: string;
};

/**
 * GAP2-FINANCE-SANCTIONS-TOTALS-04: tenant-wide sanction totals for the
 * register stat cards, aggregated in the DB so the approved-value money total
 * and the counts are never summed from a capped page. Buckets by the same
 * approved|pending|rejected mapping the rows use; "active" = approved + pending
 * (rejected excluded), matching the web's summariseSanctions.
 */
export async function getSanctionsSummary(tenantId: string): Promise<SanctionsSummary> {
  const rows = await repo.getSanctionStatusAggregates(tenantId);
  const s: SanctionsSummary = { total: 0, active: 0, pending: 0, approved: 0, approvedMinor: "0" };
  let approvedMinor = 0n;
  for (const r of rows) {
    s.total += r.n;
    const bucket = mapSanctionStatus(r.status);
    if (bucket === "approved") { s.approved += r.n; approvedMinor += r.sumMinor; }
    else if (bucket === "pending") { s.pending += r.n; }
  }
  s.active = s.approved + s.pending;
  s.approvedMinor = approvedMinor.toString();
  return s;
}

export async function getSanctionDetail(id: string, tenantId: string) {  const row = await cache.getOrLoad<SanctionRow>(
    cache.makeKey(tenantId, "sanction", id),
    () => repo.findSanctionByIdAndTenant(id, tenantId),
  );
  if (!row || row.tenantId !== tenantId) return null;
  const head = await repo.findHeadById(row.headId);
  // GAP2-FINANCE-SANCTIONS-OFFICER-01: resolve maker (and, where present,
  // checker) ids to real display names via identity-service, batched, fail-OPEN.
  const names = await fetchUserNames(tenantId, [row.createdBy, row.updatedBy]);
  const makerName = names.get(row.createdBy) ?? UNKNOWN_OFFICER;
  const checkerName = names.get(row.updatedBy) ?? UNKNOWN_OFFICER;
  // GAP2-FINANCE-SANCTIONS-DETAIL-STUB-02: build the approval trail from the
  // maker-create and (once approved) checker-approve the sanction row already
  // records (createdBy/createdAt + updatedBy/updatedAt), instead of a hard-coded
  // []. "approved" is the terminal state the R11 maker-checker /approve (or the
  // eOffice decision) sets; "cancelled" is a reject. A still-pending sanction
  // has only the create event. Line items have no backing table, so stay [].
  const approvalTrail: Array<{ action: string; actor: string; timestamp: string }> = [
    { action: "created", actor: makerName, timestamp: new Date(row.createdAt as unknown as string).toISOString() },
  ];
  if (row.status === "approved") {
    approvalTrail.push({ action: "approved", actor: checkerName, timestamp: new Date(row.updatedAt as unknown as string).toISOString() });
  } else if (row.status === "cancelled") {
    approvalTrail.push({ action: "rejected", actor: checkerName, timestamp: new Date(row.updatedAt as unknown as string).toISOString() });
  }
  return {
    id: row.id,
    sanctionNo: row.sanctionNo,
    subject: row.purpose,
    // H3: string to avoid 2^53 precision loss on large government sanction amounts.
    amount: row.amountMinor.toString(),
    sanctionedBy: makerName,
    date: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
    status: mapSanctionStatus(row.status),
    majorHead: head?.code ?? row.headId,
    lineItems: [],
    approvalTrail,
    efileInFlight: row.efileSubmittedAt != null,
    ...(row.efileFileNo ? { efileFileNo: row.efileFileNo } : {}),
  };
}
