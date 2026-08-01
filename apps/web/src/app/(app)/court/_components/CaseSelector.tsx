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
import type { CourtCase } from "../_data/types";
import { humanize } from "../_data/format";

export function CaseSelector({
  cases,
  basePath,
  selectedCaseId,
}: {
  cases: CourtCase[];
  basePath: string;
  selectedCaseId: string;
}) {
  const router = useRouter();
  const selectId = useId();

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
