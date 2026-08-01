"use client";

/**
 * CaseSelector — shared case-picker used by the standalone hearings/orders
 * consoles (both hearing and order lists are case-scoped server-side; there
 * is no flat "all hearings" / "all orders" GET). Picking a case navigates to
 * `${basePath}?caseId=...` so the server page re-fetches that case's rows.
 */
import { useId } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { CourtCase } from "../_data/types";
import { humanize } from "../_data/format";

export function CaseSelector({
  cases,
  casesSource,
  basePath,
  selectedCaseId,
}: {
  cases: CourtCase[];
  /** Whether `cases` actually reflects live data — "error" means the fetch
   *  failed, so an empty list here is NOT evidence there are no cases. */
  casesSource: "api" | "error";
  basePath: string;
  selectedCaseId: string;
}) {
  const router = useRouter();
  const selectId = useId();

  if (casesSource === "error") {
    return (
      <>
        <DataSourceBadge source="error" />
        <EmptyState
          icon="🗂️"
          title="Couldn't load your cases"
          message="Live data couldn't be reached, so the case list isn't available right now. Try again shortly."
        />
      </>
    );
  }

  if (cases.length === 0) {
    return (
      <EmptyState
        icon="🗂️"
        title="No cases to pick from"
        message="Register a case first, then come back here to work its hearings and orders."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <label htmlFor={selectId} style={{ fontSize: 13, fontWeight: 600 }}>
        Case
      </label>
      <select
        id={selectId}
        value={selectedCaseId}
        onChange={(e) => {
          const id = e.target.value;
          router.push(id ? `${basePath}?caseId=${encodeURIComponent(id)}` : basePath);
        }}
        style={{
          padding: 8,
          borderRadius: 8,
          border: "1px solid var(--line)",
          fontSize: 13.5,
          minWidth: 280,
        }}
      >
        <option value="">Pick a case…</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {(c.title || "Untitled matter") + (c.cnrNumber ? ` · ${c.cnrNumber}` : "")}
            {" — "}
            {humanize(c.status)}
          </option>
        ))}
      </select>
    </div>
  );
}
