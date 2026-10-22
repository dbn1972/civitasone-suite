"use client";
/**
 * DirectoryUserSelect -- a <select> over the tenant's staff directory that never silently omits people.
 *
 * crm-service's GET /v1/crm/directory/users is BOUNDED (a large tenant has more people than it
 * returns) and says so (`truncated`). A plain <select> over that list would quietly leave the rest
 * out of every picker that uses it: the task-escalation manager picker, the overdue-task Reassign
 * dialog, the service-request Assign dialog, the lead-escalation recipient picker. So when the list
 * is truncated this says "showing the first N people" and offers a NAME search that asks the
 * server (searchEscalationUsers: GET /v1/crm/directory/users?q=), which reaches everyone. When the
 * list is complete nothing extra is rendered and this is exactly a <select>.
 *
 * The chosen user stays visible and selectable while the options change under it (a search result
 * the reader picked is remembered), and a stored id that is in neither list gets the caller's
 * "not listed" label instead of vanishing.
 */
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { searchEscalationUsers, type EscalationUser } from "@/lib/crm/activityAccount";

/** The server needs at least this many characters to search (mirrors USER_SEARCH_MIN_CHARS). */
export const DIRECTORY_SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 300;

const IDLE = { phase: "idle" } as const;

type SearchState =
  | typeof IDLE
  | { phase: "loading" }
  | { phase: "failed" }
  | { phase: "done"; users: EscalationUser[]; capped: boolean };

export interface DirectoryUserSelectProps {
  /** Required: the caller's <label htmlFor> points here. */
  id: string;
  value: string;
  onChange: (userId: string) => void;
  /** The directory as loaded (getEscalationUsers). */
  users: EscalationUser[];
  /** True = `users` is not the whole directory: show the truncation note and the name search. */
  truncated?: boolean;
  /** A user to leave out of the choices (e.g. the current owner). */
  excludeId?: string | null;
  /** Options rendered first inside the <select> (the empty "choose / no specific user" option). */
  leading?: ReactNode;
  /** Label of a selected id that is in neither the loaded list nor a search result. */
  unlistedLabel?: string;
  /** Same, when the list is truncated (the person may exist; they are just not in the loaded page). */
  unlistedTruncatedLabel?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | undefined;
  /**
   * Accessible name of the name-search box (default: "Search people by name"). A screen that renders one
   * picker per row passes a name that tells the rows apart ("... for rule 2"), so each box is distinguishable.
   */
  searchLabel?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

export function DirectoryUserSelect({
  id,
  value,
  onChange,
  users,
  truncated = false,
  excludeId = null,
  leading,
  unlistedLabel,
  unlistedTruncatedLabel,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  searchLabel,
  disabled,
  style,
}: DirectoryUserSelectProps) {
  const t = useTranslations("crmDirectoryUserSelect");
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>(IDLE);
  // Everyone seen in a search so far, so a person picked from results stays listed (and named) after the query changes.
  const [found, setFound] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    const q = query.trim();
    if (!truncated || q.length < DIRECTORY_SEARCH_MIN_CHARS) {
      setSearch((prev) => (prev.phase === "idle" ? prev : IDLE));
      return;
    }
    let live = true;
    setSearch({ phase: "loading" });
    const timer = setTimeout(() => {
      void searchEscalationUsers(q).then((res) => {
        if (!live) return;
        if (res.source === "error") {
          setSearch({ phase: "failed" });
          return;
        }
        setFound((prev) => new Map([...prev, ...res.data.map((u) => [u.id, u.name] as const)]));
        setSearch({ phase: "done", users: res.data, capped: res.truncated === true });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, truncated]);

  const shown = (search.phase === "done" ? search.users : users).filter((u) => u.id !== excludeId);
  const shownIds = new Set(shown.map((u) => u.id));
  const selectedName = value ? (users.find((u) => u.id === value)?.name ?? found.get(value)) : undefined;
  const missingLabel = truncated ? (unlistedTruncatedLabel ?? unlistedLabel) : unlistedLabel;

  const select = (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
      {...(ariaInvalid !== undefined ? { "aria-invalid": ariaInvalid } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(style !== undefined ? { style } : {})}
    >
      {leading}
      {value && !shownIds.has(value) && (selectedName !== undefined || missingLabel !== undefined) ? (
        <option value={value}>{selectedName ?? missingLabel}</option>
      ) : null}
      {shown.map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  );

  // A complete directory is just the select.
  if (!truncated) return select;

  // ONE polite status region, mounted for as long as the picker is truncated: a live region that is created
  // together with its text is not reliably announced, so the element stays and only its text changes.
  const message =
    search.phase === "loading" ? t("searching")
    : search.phase === "failed" ? t("searchFailed")
    : search.phase === "done" && search.users.length === 0 ? t("noMatches", { query: query.trim() })
    : search.phase === "done" && search.capped ? t("moreMatches", { count: search.users.length })
    : search.phase === "done" ? t("resultsFound", { count: search.users.length })
    : t("truncatedNote", { count: users.length });

  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      {select}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={searchLabel ?? t("searchLabel")}
        aria-describedby={statusId}
        placeholder={t("searchPlaceholder", { min: DIRECTORY_SEARCH_MIN_CHARS })}
        autoComplete="off"
        {...(disabled !== undefined ? { disabled } : {})}
        style={{ padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%", fontSize: 13 }}
      />
      <span
        id={statusId}
        role="status"
        aria-live="polite"
        style={{ fontSize: 12, color: search.phase === "failed" ? "var(--bad)" : "var(--muted)" }}
      >
        {message}
      </span>
    </span>
  );
}
