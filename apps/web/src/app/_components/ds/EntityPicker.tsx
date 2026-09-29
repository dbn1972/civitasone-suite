"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "./Input";

export interface EntityOption {
  id: string;
  label: string;
  sublabel?: string;
}

export interface EntityPickerProps {
  /** Selected id (single mode), ids (multiple mode), or nothing selected. */
  value: string | string[] | null;
  onChange: (value: string | string[] | null) => void;
  /**
   * Debounced, cancellable search -- the only required data dependency.
   * Called with the trimmed query text and an AbortSignal that fires when a
   * newer keystroke supersedes this call; adapters should pass `signal`
   * straight through to `fetch` so a slow, stale request never overwrites a
   * fresher result.
   */
  search: (query: string, signal: AbortSignal) => Promise<EntityOption[]>;
  /**
   * Batch id -> option lookup, used to pre-populate the visible label(s)
   * for `value` on mount and whenever `value` changes to include an id this
   * picker hasn't seen yet (e.g. an edit form seeding from a previously
   * saved id). This is what fixes a "blank on every visit" bug
   * (GAP-HR-EMPLOYEES-DETAIL-EDIT-04): without it, a picker seeded with a
   * bare id and nothing else has no label to show until the user retypes.
   * Optional -- omit when `initialOptions` already covers every id in
   * `value`, or when `value` is always freshly chosen and never seeded
   * from stored data.
   */
  resolve?: (ids: string[]) => Promise<EntityOption[]>;
  /**
   * Options the caller already has both id AND label for (e.g. from the
   * same payload that supplied `value`) -- skips a resolve() round-trip for
   * exactly those ids. `resolve` still covers any id in `value` not present
   * here.
   */
  initialOptions?: EntityOption[];
  /** Multi-select: `value`/`onChange` carry an id array and selections render as removable chips. */
  multiple?: boolean;
  /** Renders a hidden input (or one per selected id, in multiple mode) sharing this name, for a plain HTML form post. */
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Minimum trimmed query length before `search` is called at all. */
  minQueryLength?: number;
  debounceMs?: number;
  noResultsText?: string;
  searchingText?: string;
  removeOptionAriaLabel?: (label: string) => string;
  /** Accessible name for standalone use (no ancestor Field, no visible label). Ignored when a Field label already provides one. */
  "aria-label"?: string;
  /** Explicit id for the input; falls back to an ancestor Field's id, then an auto-generated one -- see Input's own doc comment. */
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}

function idsOf(value: string | string[] | null): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Generic server-search picker (SF-06): replaces raw free-text/id entry --
 * a bare UUID input, or a `<select>` whose options were fetched wholesale
 * (see EditEmployeeForm.tsx's pre-conversion managerId field, which fetched
 * up to 500 employees in one uncached call to populate a plain `<select>`)
 * -- with a debounced, cancellable, named search over a caller-supplied
 * adapter.
 *
 * Deliberately knows nothing about employees, pay structures, or any other
 * concrete entity: `search`/`resolve` are the only data dependency, both
 * working over the same generic `{id, label, sublabel}` shape, so the same
 * component serves HR today and the other modules redesign/gaps/
 * SHARED_FIXES.md's SF-06 entry lists (works, finance, estab) later, just
 * by passing a different adapter -- see lib/entityAdapters/ for the
 * employee and pay-structure ones this PR ships.
 *
 * Built on the Field/Input primitives (SF-14): renders its text box as a
 * plain `Input`, so nesting this inside a `Field` wires up label
 * association, aria-invalid/aria-describedby/aria-required and disabled
 * exactly like a bare `Input` would -- this component adds no id/aria
 * plumbing of its own for the input itself, only for the listbox/status
 * region it owns.
 *
 * @example
 * ```tsx
 * <Field label="Manager" error={formError.fieldError("managerId")}>
 *   <EntityPicker
 *     value={managerId}
 *     onChange={(v) => setManagerId(Array.isArray(v) ? v[0] ?? null : v)}
 *     search={searchEmployees}
 *     resolve={resolveEmployees}
 *     initialOptions={employee.managerId ? [{ id: employee.managerId, label: employee.reportingTo! }] : undefined}
 *   />
 * </Field>
 * ```
 */
export function EntityPicker({
  value,
  onChange,
  search,
  resolve,
  initialOptions,
  multiple = false,
  name,
  placeholder = "Type to search…",
  disabled,
  minQueryLength = 1,
  debounceMs = 300,
  noResultsText = "No matches",
  searchingText = "Searching…",
  removeOptionAriaLabel = (label: string) => `Remove ${label}`,
  "aria-label": ariaLabel,
  id,
  className,
  style,
}: EntityPickerProps) {
  const auxId = useId();
  const listboxId = `${auxId}-listbox`;
  const statusId = `${auxId}-status`;

  const wrapRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedIdsRef = useRef<Set<string>>(new Set());

  // Lazy-initialized from `initialOptions` at mount time (not via a
  // useEffect) so `known` is already correct before the resolve()-fallback
  // effect below ever runs -- both would otherwise fire from the same
  // initial render, and the resolve effect would see this state's stale,
  // still-empty pre-mount value (a real race, caught by this component's
  // own test: "initialOptions ... without ever calling resolve").
  const [known, setKnown] = useState<Map<string, EntityOption>>(
    () => new Map((initialOptions ?? []).map((opt) => [opt.id, opt])),
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<EntityOption[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedIds = useMemo(() => idsOf(value), [value]);

  // Merge caller-supplied labels immediately (synchronous, no network) --
  // avoids a resolve() round-trip entirely when the caller already has
  // both id and label in hand (e.g. from the same payload as `value`).
  useEffect(() => {
    if (!initialOptions || initialOptions.length === 0) return;
    setKnown((prev) => {
      const next = new Map(prev);
      for (const opt of initialOptions) next.set(opt.id, opt);
      return next;
    });
    // Only re-run when the actual id set changes, not on every render with
    // a fresh-identity array literal (see EditEmployeeForm.tsx's usage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOptions?.map((o) => o.id).join(",")]);

  // Pre-populate labels for any selected id this picker hasn't seen yet --
  // the GAP-HR-EMPLOYEES-DETAIL-EDIT-04 fix. resolvedIdsRef stops this from
  // re-requesting the same id forever when the adapter legitimately has no
  // label for it (e.g. a stale/deleted id) -- such an id just displays as
  // itself (see displayValue/chip label fallbacks below) instead of retrying.
  useEffect(() => {
    if (!resolve) return;
    const missing = selectedIds.filter((sid) => !known.has(sid) && !resolvedIdsRef.current.has(sid));
    if (missing.length === 0) return;
    for (const sid of missing) resolvedIdsRef.current.add(sid);
    let cancelled = false;
    resolve(missing)
      .then((opts) => {
        if (cancelled || opts.length === 0) return;
        setKnown((prev) => {
          const next = new Map(prev);
          for (const opt of opts) next.set(opt.id, opt);
          return next;
        });
      })
      .catch(() => {
        /* leave unresolved ids showing their raw id -- see fallbacks below */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(","), resolve, known]);

  const runSearch = useCallback(
    (q: string) => {
      abortRef.current?.abort();
      if (q.trim().length < minQueryLength) {
        setResults([]);
        setLoading(false);
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      search(q.trim(), controller.signal)
        .then((opts) => {
          if (controller.signal.aborted) return;
          setResults(opts);
          setLoading(false);
          setActiveIndex(opts.length > 0 ? 0 : -1);
          setKnown((prev) => {
            const next = new Map(prev);
            for (const opt of opts) next.set(opt.id, opt);
            return next;
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          setResults([]);
          setLoading(false);
        });
    },
    [search, minQueryLength],
  );

  function handleQueryChange(text: string) {
    setQuery(text);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (debounceMs <= 0) {
      runSearch(text);
    } else {
      debounceRef.current = setTimeout(() => runSearch(text), debounceMs);
    }
  }

  function selectOption(opt: EntityOption) {
    setKnown((prev) => new Map(prev).set(opt.id, opt));
    if (multiple) {
      if (!selectedIds.includes(opt.id)) onChange([...selectedIds, opt.id]);
    } else {
      onChange(opt.id);
    }
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function removeId(idToRemove: string) {
    if (multiple) {
      onChange(selectedIds.filter((sid) => sid !== idToRemove));
    } else {
      onChange(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (e.key === "Backspace" && query === "" && multiple && selectedIds.length > 0) {
      removeId(selectedIds[selectedIds.length - 1]!);
      return;
    }
    if (!open) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && results[activeIndex]) selectOption(results[activeIndex]);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Unmount cleanup: a pending debounce/in-flight request must never touch
  // state after this component is gone.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const singleLabel = !multiple && selectedIds[0] ? (known.get(selectedIds[0])?.label ?? selectedIds[0]) : undefined;
  const displayValue = open ? query : (singleLabel ?? query);
  const activeOption = activeIndex >= 0 ? results[activeIndex] : undefined;
  const activeId = activeOption ? `${auxId}-option-${activeOption.id}` : undefined;
  const showStatus = open && (loading || (query.trim().length >= minQueryLength && results.length === 0));

  return (
    <div ref={wrapRef} className={className} style={{ position: "relative", display: "grid", gap: 6, ...style }}>
      {multiple && selectedIds.length > 0 && (
        <ul style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
          {selectedIds.map((sid) => {
            const label = known.get(sid)?.label ?? sid;
            return (
              <li
                key={sid}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: "var(--panel-2, #f1f5f9)",
                  border: "1px solid var(--line, #cbd5e1)",
                  fontSize: 13,
                }}
              >
                {label}
                <button
                  type="button"
                  onClick={() => removeId(sid)}
                  disabled={disabled}
                  aria-label={removeOptionAriaLabel(label)}
                  style={{
                    border: "none",
                    background: "none",
                    cursor: disabled ? "default" : "pointer",
                    padding: 0,
                    lineHeight: 1,
                    color: "var(--mut, #64748b)",
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Input
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        type="text"
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      {name && !multiple && <input type="hidden" name={name} value={selectedIds[0] ?? ""} />}
      {name && multiple && selectedIds.map((sid) => <input key={sid} type="hidden" name={name} value={sid} />)}

      <span
        id={statusId}
        role="status"
        aria-live="polite"
        style={
          showStatus
            ? { fontSize: 12, color: "var(--mut, #64748b)" }
            : { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }
        }
      >
        {showStatus ? (loading ? searchingText : noResultsText) : ""}
      </span>

      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-multiselectable={multiple || undefined}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            zIndex: 100,
            background: "var(--panel, #fff)",
            border: "1px solid var(--line, #cbd5e1)",
            borderRadius: 10,
            maxHeight: 240,
            overflow: "auto",
            listStyle: "none",
            padding: 4,
            margin: 0,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          {results.map((opt, idx) => (
            <li
              key={opt.id}
              id={`${auxId}-option-${opt.id}`}
              role="option"
              aria-selected={idx === activeIndex}
              // mousedown (not click) fires and completes selection before
              // the input's blur/outside-click handler would otherwise
              // close the dropdown out from under the click.
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(opt);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
                background: idx === activeIndex ? "var(--panel-2, #eff6ff)" : "transparent",
              }}
            >
              <div>{opt.label}</div>
              {opt.sublabel && <div style={{ fontSize: 12, color: "var(--mut, #64748b)" }}>{opt.sublabel}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
