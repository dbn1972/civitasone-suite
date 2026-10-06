"use client";

/**
 * CaseSelector — shared case-picker used by the standalone hearings/orders
 * consoles (both hearing and order lists are case-scoped server-side; there
 * is no flat "all hearings" / "all orders" GET). Picking a case navigates to
 * `${basePath}?caseId=...` so the server page re-fetches that case's rows.
 */
import { useId, useState } from "react";
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
      <CaseCombobox
        id={selectId}
        cases={cases}
        selectedCaseId={selectedCaseId}
        onPick={(id) => router.push(id ? `${basePath}?caseId=${encodeURIComponent(id)}` : basePath)}
      />
      {cases.length >= 100 && (
        <span style={{ fontSize: 12, color: "var(--ink2)" }}>
          Showing the first 100 cases — type a CNR or title to narrow; refine on the Cases page for older matters.
        </span>
      )}
    </div>
  );
}

/**
 * A keyboard-operable, searchable case combobox (GAP-COURT-HEARINGS-02):
 * replaces a plain <select> listing the whole registry. Filters the provided
 * options by title / CNR as the user types (a native text input + listbox),
 * so a long list is navigable; selecting navigates to the case.
 */
function CaseCombobox({
  id,
  cases,
  selectedCaseId,
  onPick,
}: {
  id: string;
  cases: CourtCase[];
  selectedCaseId: string;
  onPick: (id: string) => void;
}) {
  const selected = cases.find((c) => c.id === selectedCaseId);
  const selectedLabel = selected
    ? (selected.title || "Untitled matter") + (selected.cnrNumber ? ` · ${selected.cnrNumber}` : "")
    : "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const listId = `${id}-listbox`;

  const q = query.trim().toLowerCase();
  const matches = (
    q && q !== selectedLabel.toLowerCase()
      ? cases.filter(
          (c) =>
            (c.title ?? "").toLowerCase().includes(q) ||
            c.cnrNumber.toLowerCase().includes(q) ||
            (c.filingNumber ?? "").toLowerCase().includes(q),
        )
      : cases
  ).slice(0, 20);

  return (
    <div style={{ position: "relative", minWidth: 280 }}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder="Search by title or CNR…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        style={{
          padding: 8,
          borderRadius: 8,
          border: "1px solid var(--line)",
          fontSize: 13.5,
          width: "100%",
        }}
      />
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 2px)",
            insetInlineStart: 0,
            insetInlineEnd: 0,
            maxHeight: 260,
            overflowY: "auto",
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "var(--panel, #fff)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,.12)",
          }}
        >
          {matches.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === selectedCaseId}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery((c.title || "Untitled matter") + (c.cnrNumber ? ` · ${c.cnrNumber}` : ""));
                  setOpen(false);
                  onPick(c.id);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "start",
                  padding: "6px 8px",
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600 }}>{c.title || "Untitled matter"}</span>
                {c.cnrNumber && <span style={{ color: "var(--ink2)" }}> · {c.cnrNumber}</span>}
                <span style={{ color: "var(--ink2)" }}> — {humanize(c.status)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
