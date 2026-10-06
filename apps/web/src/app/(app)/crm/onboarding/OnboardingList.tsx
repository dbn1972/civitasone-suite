"use client";
/**
 * OnboardingList — P1-9. Lists customer onboarding cases.
 *
 * GAP-CRM-ONBOARDING-02: the hand-rolled <table> is replaced by the shared
 * ds/DataTable, so the register gets client-side sort (every column), a search
 * box, and pagination (25/page) — matching every other CRM list and keeping a
 * long case list usable. The backend list endpoint caps a page at 200 rows
 * (shared list-query MAX_PAGE_SIZE) and defaults to 50; this view fetches a
 * larger page (up to the cap) and paginates it client-side for sort/search to
 * work across the whole fetched set.
 *
 * GAP-CRM-ONBOARDING-03: a KYC-status filter (the completion gate) and an
 * "Age in stage" column (days since updatedAt) with an Overdue pill past the
 * SLA threshold, so a case stuck in a stage is visible at a glance.
 *
 * Every read is gated on source==="error": on a failed load we render the
 * saved-info badge and an explicit "couldn't load" message, never a fabricated
 * empty list as fact. Status is shown as icon+label (not colour-only).
 */
import { useEffect, useId, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { DataTable, StatusPill } from "../../../_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import {
  getOnboardingCases,
  getOnboardingLookups,
  resolveCaseNames,
  ONBOARDING_STAGES,
  KYC_STATUSES,
  isOnboardingStage,
  isKycStatus,
  stagePillVariant,
  kycPillVariant,
  type OnboardingCase,
  type OnboardingStage,
  type KycStatus,
  type OnbSource,
} from "@/lib/crm/onboarding";

/** Case rows older than this (in their current stage) are flagged Overdue. */
export const ONBOARDING_STAGE_SLA_DAYS = 7;

function fmtDate(iso: string): string {
  // GAP-CRM-ONBOARDING-05: shared IST date-time formatter ("dd Mon yyyy,
  // hh:mm") instead of toLocaleString('en-IN') (browser timezone, with seconds).
  return formatIndianDateTime(iso);
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id || "—";
}

/** Whole days since `iso` (never negative), or null when the date is unusable. */
export function daysSince(iso: string, now: number = Date.now()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now - d.getTime()) / 86_400_000));
}

interface Row extends Record<string, unknown> {
  id: string;
  customer: string;
  ref: string;
  stage: string;
  stageSort: string;
  kyc: string;
  kycSort: string;
  account: string;
  updated: string;
  updatedSort: number;
  ageDays: number | null;
}

export function OnboardingList() {
  const t = useTranslations("crmOnboardingList");
  const stageText = useCallback((s: string): string => (isOnboardingStage(s) ? t(`stage_${s}`) : s), [t]);
  const kycText = useCallback((s: string): string => (isKycStatus(s) ? t(`kyc_${s}`) : s), [t]);
  const [stage, setStage] = useState<OnboardingStage | "">("");
  const [kyc, setKyc] = useState<KycStatus | "">("");
  const [cases, setCases] = useState<OnboardingCase[]>([]);
  const [source, setSource] = useState<OnbSource | "loading">("loading");
  // GAP-CRM-ONBOARDING-04: bump to re-run the fetch from the error-state Retry.
  const [reload, setReload] = useState(0);
  const stageFilterId = useId();
  const kycFilterId = useId();

  useEffect(() => {
    let alive = true;
    setSource("loading");
    // GAP-CRM-ONBOARDING-01: resolve deal/account names alongside the cases so a
    // row is identified by its customer, not an 8-char UUID fragment.
    // GAP-CRM-ONBOARDING-02: ask the backend for a full page (its 200-row cap)
    // so client-side sort/search/paging operate over the whole set, not just 50.
    void Promise.all([
      getOnboardingCases({ ...(stage ? { stage } : {}), limit: 200 }),
      getOnboardingLookups(),
    ]).then(([{ data, source: s }, lookups]) => {
      if (!alive) return;
      setCases(resolveCaseNames(data, lookups));
      setSource(s);
    });
    return () => {
      alive = false;
    };
  }, [stage, reload]);

  const isError = source === "error";
  const isLoading = source === "loading";

  // GAP-CRM-ONBOARDING-03: KYC status filter is applied client-side (the
  // onboarding list endpoint filters by stage/accountId only, not KYC).
  const filteredCases = useMemo(
    () => (kyc ? cases.filter((c) => c.kycStatus === kyc) : cases),
    [cases, kyc],
  );

  const rows: Row[] = useMemo(() => {
    const now = Date.now();
    return filteredCases.map((c) => {
      const age = daysSince(c.updatedAt, now);
      return {
        id: c.id,
        customer: c.dealName ?? c.accountName ?? t("unnamedCase"),
        ref: shortId(c.id),
        stage: c.stage,
        stageSort: stageText(c.stage),
        kyc: c.kycStatus,
        kycSort: kycText(c.kycStatus),
        account: c.accountName ?? (c.accountId ? shortId(c.accountId) : "—"),
        updated: c.updatedAt,
        updatedSort: new Date(c.updatedAt).getTime() || 0,
        ageDays: age,
      };
    });
  }, [filteredCases, t, stageText, kycText]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
          <span id={`${stageFilterId}-l`}>{t("stage")}</span>
          <select
            aria-labelledby={`${stageFilterId}-l`}
            value={stage}
            onChange={(e) => setStage(e.target.value as OnboardingStage | "")}
            style={{ padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
          >
            <option value="">{t("allStages")}</option>
            {ONBOARDING_STAGES.map((s) => (
              <option key={s} value={s}>
                {stageText(s)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
          <span id={`${kycFilterId}-l`}>{t("kycStatus")}</span>
          <select
            aria-labelledby={`${kycFilterId}-l`}
            value={kyc}
            onChange={(e) => setKyc(e.target.value as KycStatus | "")}
            style={{ padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
          >
            <option value="">{t("allKyc")}</option>
            {KYC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {kycText(s)}
              </option>
            ))}
          </select>
        </label>
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>{t("onboardingCases")}</h3>
        </div>
        {isLoading ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
            {t("loadingCases")}
          </p>
        ) : isError ? (
          // GAP-CRM-ONBOARDING-04: a single data-source badge (the filter-row
          // one above), plus a working Retry — not a second badge and no way to
          // re-try.
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
            {t("loadError")}
            <button type="button" className="btn" style={{ fontSize: 13 }} onClick={() => setReload((n) => n + 1)}>
              {t("retry")}
            </button>
          </p>
        ) : (
          <DataTable<Row>
            columns={[
              {
                key: "customer",
                label: t("colCustomerDeal"),
                render: (r) => (
                  <>
                    {/* GAP-CRM-ONBOARDING-05: next/link for client-side nav
                        instead of a full-page-reload <a>. */}
                    <Link href={`/crm/onboarding/${r.id}`}>{r.customer}</Link>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("ref", { id: r.ref })}</div>
                  </>
                ),
              },
              {
                key: "stageSort",
                label: t("stage"),
                render: (r) => (
                  // GAP-CRM-ONBOARDING-06: theme-safe tone pill instead of a
                  // cross-platform-inconsistent emoji glyph.
                  <StatusPill status={r.stage} label={stageText(r.stage)} variant={stagePillVariant(r.stage)} />
                ),
              },
              {
                key: "kycSort",
                label: t("colKyc"),
                render: (r) => (
                  <StatusPill status={r.kyc} label={kycText(r.kyc)} variant={kycPillVariant(r.kyc)} />
                ),
              },
              { key: "account", label: t("colAccount") },
              {
                key: "ageDays",
                label: t("colAgeInStage"),
                align: "right",
                render: (r) => {
                  if (r.ageDays === null) return <span>—</span>;
                  const overdue = r.ageDays >= ONBOARDING_STAGE_SLA_DAYS;
                  return (
                    <span
                      className={overdue ? "pill bad" : undefined}
                      title={overdue ? t("overdueTitle", { days: r.ageDays, sla: ONBOARDING_STAGE_SLA_DAYS }) : undefined}
                    >
                      {overdue ? t("ageOverdue", { days: r.ageDays }) : t("ageDays", { days: r.ageDays })}
                    </span>
                  );
                },
              },
              {
                key: "updatedSort",
                label: t("colUpdated"),
                render: (r) => <span style={{ fontSize: 13 }}>{fmtDate(r.updated)}</span>,
              },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            filterKeys={["customer", "account", "ref"]}
            pageSize={25}
            emptyIcon="📋"
            emptyTitle={t("emptyTitle")}
            emptyMessage={
              stage
                ? t("emptyInStage", { stage: stageText(stage) })
                : kyc
                  ? t("emptyWithKyc", { status: kycText(kyc) })
                  : t("emptyDefault")
            }
          />
        )}
      </div>
    </>
  );
}
