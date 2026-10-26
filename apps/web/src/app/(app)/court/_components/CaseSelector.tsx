"use client";

/**
 * CaseSelector — shared case-picker used by the standalone hearings/orders
 * consoles (both hearing and order lists are case-scoped server-side; there
 * is no flat "all hearings" / "all orders" GET). Picking a case navigates to
 * `${basePath}?caseId=...` so the server page re-fetches that case's rows.
 */
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { CourtCase } from "../_data/types";
import { humanize } from "../_data/format";
import { searchCases } from "../_data/client";

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
  const t = useTranslations("courtCaseSelector");
  const selectId = useId();

  if (casesSource === "error") {
    return (
      <>
        <DataSourceBadge source="error" />
        <EmptyState
          icon="🗂️"
          title={t("loadErrorTitle")}
          message={t("loadErrorBody")}
        />
      </>
    );
  }

  if (cases.length === 0) {
    return (
      <EmptyState
        icon="🗂️"
        title={t("emptyTitle")}
        message={t("emptyBody")}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <label htmlFor={selectId} style={{ fontSize: 13, fontWeight: 600 }}>
        {t("label")}
      </label>
      <CaseCombobox
        id={selectId}
        cases={cases}
        selectedCaseId={selectedCaseId}
        onPick={(id) => router.push(id ? `${basePath}?caseId=${encodeURIComponent(id)}` : basePath)}
      />
      {cases.length >= 100 && (
        <span style={{ fontSize: 12, color: "var(--ink2)" }}>
          {t("truncated")}
        </span>
      )}
    </div>
  );
}

/**
 * A keyboard-operable, searchable case combobox (GAP-COURT-HEARINGS-02).
 * Typing filters the preloaded options immediately, then asks the server
 * (`?q=` on the cases list) so a case beyond the preloaded first page is
 * still reachable. ArrowUp/Down move the active option, Enter picks, Escape
 * closes (WAI-ARIA combobox + listbox, aria-activedescendant).
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
  const t = useTranslations("courtCaseSelector");
  const selected = cases.find((c) => c.id === selectedCaseId);
  const labelOf = (c: CourtCase) => (c.title || t("untitled")) + (c.cnrNumber ? ` · ${c.cnrNumber}` : "");
  const selectedLabel = selected ? labelOf(selected) : "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<{ q: string; rows: CourtCase[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const listId = `${id}-listbox`;

  const q = query.trim();
  const ql = q.toLowerCase();
  const searchable = q !== "" && ql !== selectedLabel.toLowerCase();

  // Server-side search, debounced; stale responses are discarded.
  useEffect(() => {
    if (!searchable) {
      setRemote(null);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchFailed(false);
    const timer = setTimeout(() => {
      searchCases(q, 20)
        .then((rows) => {
          if (cancelled) return;
          setRemote({ q, rows });
          setSearching(false);
        })
        .catch(() => {
          if (cancelled) return;
          setRemote(null);
          setSearching(false);
          setSearchFailed(true);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, searchable]);

  const local = searchable
    ? cases.filter(
        (c) =>
          (c.title ?? "").toLowerCase().includes(ql) ||
          c.cnrNumber.toLowerCase().includes(ql) ||
          (c.filingNumber ?? "").toLowerCase().includes(ql),
      )
    : cases;
  const matches = (remote && remote.q === q ? remote.rows : local).slice(0, 20);
  const showEmpty = searchable && remote?.q === q && matches.length === 0 && !searching;

  function pick(c: CourtCase) {
    setQuery(labelOf(c));
    setOpen(false);
    setActive(-1);
    onPick(c.id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (matches.length === 0 ? -1 : Math.min(i + 1, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (matches.length === 0 ? -1 : Math.max(i - 1, 0)));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && matches[active]) {
        e.preventDefault();
        pick(matches[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div style={{ position: "relative", minWidth: 280 }}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 && matches[active] ? optionId(active) : undefined}
        placeholder={t("placeholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
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
      {open && searching && (
        <div role="status" style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
          {t("searching")}
        </div>
      )}
      {open && searchFailed && (
        <div role="alert" style={{ fontSize: 12, color: "var(--danger, #b00020)", marginTop: 2 }}>
          {t("searchFailed")}
        </div>
      )}
      {open && showEmpty && (
        <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>{t("noMatches")}</div>
      )}
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
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,.12)",
          }}
        >
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active || (active < 0 && c.id === selectedCaseId)}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "start",
                  padding: "6px 8px",
                  border: 0,
                  background: i === active ? "var(--panel2, rgba(0,0,0,.06))" : "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600 }}>{c.title || t("untitled")}</span>
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
