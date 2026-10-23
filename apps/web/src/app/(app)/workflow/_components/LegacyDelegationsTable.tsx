"use client";

/**
 * Admin "Legacy delegations" report (client). Lists ACTIVE delegations created before role scoping (they carry no
 * roles, so they pass on nothing) with their creator, so each can be re-issued with an explicit role scope.
 *
 * GET /v1/workflow/delegations/legacy-report (workflow-service; workflow_admin, super_admin, tenant_admin).
 * Row shape: { id, createdBy, delegateId, fromDate, toDate, reason, createdAt }. The page gates the route by role;
 * the service re-checks, and a 403 here reads as "no access" rather than a retryable failure.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState, ErrorState, PageHeader, SkeletonTable } from "@/app/_components/ds";
import { formatIndianDate, formatIndianDateTime, formatShortId } from "@/lib/formatters";
import { resolveDirectoryUsers } from "@/lib/directory/searchUsers";
import { parseLegacyReport, type LegacyDelegation } from "../_data/delegations";

const URL_BASE = "/api/proxy/v1/workflow/delegations/legacy-report";
const LIMIT = 200;

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "ready"; rows: LegacyDelegation[]; total: number };

export function LegacyDelegationsTable() {
  const t = useTranslations("workflowDelegations");
  const [state, setState] = useState<State>({ status: "loading" });
  const [names, setNames] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`${URL_BASE}?limit=${LIMIT}`, { cache: "no-store" });
      if (res.status === 403) { setState({ status: "forbidden" }); return; }
      if (!res.ok) { setState({ status: "error" }); return; }
      const parsed = parseLegacyReport(await res.json());
      setState(parsed ? { status: "ready", ...parsed } : { status: "error" });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (state.status !== "ready" || state.rows.length === 0) return;
    let live = true;
    void resolveDirectoryUsers(state.rows.flatMap((r) => [r.createdBy, r.delegateId])).then((opts) => {
      if (live) setNames(new Map(opts.map((o) => [o.id, o.label])));
    });
    return () => { live = false; };
  }, [state]);

  const nameOf = (id: string) => names.get(id) ?? t("unknownPerson", { id: formatShortId(id) });

  return (
    <>
      <PageHeader
        title={t("legacyTitle")}
        subtitle={t("legacySubtitle")}
        back="/workflow/delegations"
        backLabel={t("legacyBack")}
      />
      <Card padding>
        <p style={{ margin: "0 0 12px" }}>{t("legacyIntro")}</p>
        {state.status === "loading" ? (
          <div role="status" aria-busy="true">
            <span className="sr-only">{t("legacyLoading")}</span>
            <SkeletonTable rows={4} statCards={0} quiet />
          </div>
        ) : state.status === "forbidden" ? (
          <ErrorState error={{ what: t("legacyForbiddenTitle"), next: t("legacyForbiddenNext"), actions: [] }} />
        ) : state.status === "error" ? (
          <ErrorState
            error={{ what: t("legacyLoadError"), next: t("loadErrorNext"), actions: ["retry"] }}
            onRetry={() => void load()}
          />
        ) : state.rows.length === 0 ? (
          <EmptyState icon="✅" title={t("legacyEmptyTitle")} message={t("legacyEmptyMessage")} />
        ) : (
          <>
            {state.total > state.rows.length ? (
              <p className="mut" role="note" style={{ margin: "0 0 8px", fontSize: 13 }}>
                {t("legacyShown", { count: state.rows.length, total: state.total })}
              </p>
            ) : null}
            <DataTable<LegacyDelegation>
              rowKey={(r) => r.id}
              rows={state.rows}
              columns={[
                { key: "createdBy", label: t("legacyColCreator"), render: (r) => nameOf(r.createdBy) },
                { key: "delegateId", label: t("legacyColDelegate"), render: (r) => nameOf(r.delegateId) },
                { key: "fromDate", label: t("legacyColFrom"), render: (r) => formatIndianDate(r.fromDate) },
                { key: "toDate", label: t("legacyColTo"), render: (r) => (r.toDate ? formatIndianDate(r.toDate) : t("legacyOpenEnded")) },
                { key: "reason", label: t("legacyColReason"), render: (r) => r.reason ?? "—" },
                { key: "createdAt", label: t("legacyColCreated"), render: (r) => formatIndianDateTime(r.createdAt) },
              ]}
            />
            <p style={{ margin: "12px 0 0" }}>
              <Link href="/workflow/delegations" className="btn ghost">{t("legacyBack")}</Link>
            </p>
          </>
        )}
      </Card>
    </>
  );
}
