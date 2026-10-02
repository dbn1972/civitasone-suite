"use client";

/**
 * Shared failure-honest frame for the inventory register screens (GAP-INVENTORY-*-01).
 *
 * Every register used to compute its StatCards on the server from `[]` when the
 * fetch failed (so a down inventory-service read as an empty, healthy store)
 * and report provenance from a page-level legacy badge that could disagree
 * with the table below it (UX-002). The Table components now own the stats and
 * the body and feed both from ONE `useSeededResource` call, through this frame.
 */
import type { ReactNode } from "react";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import type { DataProvenance } from "@/lib/sync/resource";

/** True only when the server call failed and there is no cached copy to show. */
export function isNoData(provenance: DataProvenance | undefined): boolean {
  return provenance === "error-no-data";
}

/**
 * A stat value that never fabricates a zero: `null` ("—") whenever nothing
 * loaded. A legitimately empty healthy list (provenance "live") keeps its 0.
 */
export function statValue<T extends string | number>(
  provenance: DataProvenance | undefined,
  value: T,
): T | null {
  return isNoData(provenance) ? null : value;
}

export function RegisterFrame({
  provenance,
  cachedAt,
  offline,
  area,
  children,
}: {
  provenance: DataProvenance | undefined;
  cachedAt: string | null;
  offline: boolean;
  /** Plain noun for the retry copy, e.g. "bins and racks". */
  area: string;
  children: ReactNode;
}) {
  if (isNoData(provenance)) {
    return <RefreshErrorState error={toHumanError("load", { area })} backHref="/inventory" />;
  }
  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {children}
    </>
  );
}
