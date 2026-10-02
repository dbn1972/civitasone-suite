"use client";
import type { ReactNode } from "react";
import { Card, LoadErrorState, StatCard, StatGrid } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { DataProvenance } from "@/lib/sync/resource";

/**
 * One data path for an admin register's stat cards AND its table
 * (GAP-ADMIN-{INVOICES,METERING,ONBOARDING,OPERATORS}-03/-04).
 *
 * The cards used to be computed in the server page from the raw loader rows
 * while the table rendered from useSeededResource's (possibly cached) rows, so
 * a "Showing saved data" table sat under cards reading 0. Callers now compute
 * `stats` from the SAME rows useSeededResource returned and pass its
 * provenance. With nothing loaded and nothing cached ("error-no-data") every
 * card reads an em dash and a real failure state (403-aware, with retry)
 * replaces the misleading empty-table message.
 */
export interface RegisterStat {
  icon: string;
  iconBg: string;
  label: string;
  /** null = not known (rendered as an em dash, never a fake zero). */
  value: number | null;
  /** Render the card only when the value is > 0 (e.g. an "Other" bucket). */
  onlyWhenPositive?: boolean;
}

export interface AdminRegisterProps {
  title: string;
  stats: RegisterStat[];
  provenance: DataProvenance;
  cachedAt?: string | null;
  offline?: boolean;
  /** HTTP status / message of the failed server load, for the 403 vs retry split. */
  errorStatus?: number;
  errorMessage?: string;
  /** Plain noun for the "couldn't load X" copy. */
  area: string;
  children: ReactNode;
}

export function AdminRegister({ title, stats, provenance, cachedAt, offline, errorStatus, errorMessage, area, children }: AdminRegisterProps) {
  const failed = provenance === "error-no-data";
  return (
    <>
      <StatGrid>
        {stats
          .filter((s) => failed || !s.onlyWhenPositive || (s.value ?? 0) > 0)
          .map((s) => (
            <StatCard key={s.label} icon={s.icon} iconBg={s.iconBg} label={s.label} value={failed ? null : s.value} />
          ))}
      </StatGrid>
      <Card title={title}>
        {failed ? (
          <LoadErrorState result={{ status: errorStatus, errorMessage }} area={area} backHref="/admin" />
        ) : (
          <>
            <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} />
            {children}
          </>
        )}
      </Card>
    </>
  );
}
