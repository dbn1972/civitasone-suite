"use client";
import { useMemo } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { AdminRegister } from "../_components/AdminRegister";
import { onboardingStageTone, onboardingStats, toOnboardingRows, type OnboardingRow } from "./onboardingStats";

type RawRow = Record<string, unknown>;
export function OnboardingTable({
  queue,
  source = "api",
  errorStatus,
  errorMessage,
}: {
  queue: RawRow[];
  source?: "api" | "error";
  errorStatus?: number;
  errorMessage?: string;
}) {
  const { data: raw, provenance, offline, cachedAt } = useSeededResource<RawRow[]>("sa.onboarding", queue, source, (d) => d.length === 0);
  const rows = useMemo(() => toOnboardingRows(raw), [raw]);
  const s = onboardingStats(rows);
  return (
    // GAP-ADMIN-ONBOARDING-02/-03: one data path for cards, badge, failure state and table.
    <AdminRegister
      title="Onboarding Pipeline"
      area="onboarding requests"
      provenance={provenance ?? "live"}
      cachedAt={cachedAt}
      offline={offline}
      errorStatus={errorStatus}
      errorMessage={errorMessage}
      stats={[
        // GAP-ADMIN-ONBOARDING-04: In Queue excludes completed/rejected/cancelled.
        { icon: "📥", iconBg: "#eef2ff", label: "In Queue", value: s.inQueue },
        { icon: "🆕", iconBg: "#ecfdf3", label: "New Requests", value: s.newReqs },
        { icon: "🔄", iconBg: "#fffaeb", label: "In Progress", value: s.inProgress },
        { icon: "🚀", iconBg: "#fce7ee", label: "Ready for Go-Live", value: s.ready },
        { icon: "❔", iconBg: "#f1f5f9", label: "Other stage", value: s.other, onlyWhenPositive: true },
      ]}
    >
      <DataTable<OnboardingRow>
        columns={[
          { key: "org", label: "Organisation" },
          { key: "contact", label: "Contact" },
          { key: "requested", label: "Requested" },
          { key: "assigned", label: "Assigned To" },
          { key: "stage", label: "Stage", render: (r) => <StatusPill status={r.stage} variant={onboardingStageTone(r.stage)} /> },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search onboarding…" pageSize={15} exportable exportFilename="onboarding-queue" emptyIcon="📥" emptyTitle="No requests" emptyMessage="No tenant onboarding requests in queue."
      />
    </AdminRegister>
  );
}
