"use client";

/**
 * RemoteSearchSelect - an id/label combobox that SEARCHES THE SERVER as the
 * officer types, so a register larger than one page (vendors, POs) is fully
 * reachable. The old pattern - one `<select>` filled from `?limit=100` - made
 * every record past the first page unreachable (GAP-PROCUREMENT-GRN-NEW-04,
 * GAP-PROCUREMENT-CONTRACTS-NEW-05).
 *
 * Contract: `search(q, signal)` returns the matching options (it must throw on
 * a failed request - a failure is shown with a Retry, never as "no results").
 * All user-facing copy is passed in via `labels` so callers resolve it with t().
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";

export type RemoteOption = { id: string; label: string; hint?: string };

export type RemoteSearchLabels = {
  placeholder: string;
  loading: string;
  empty: string;
  error: string;
  retry: string;
  clear: string;
};

type Props = {
  inputId?: string;
  value: RemoteOption | null;
  onChange: (next: RemoteOption | null) => void;
  search: (q: string, signal: AbortSignal) => Promise<RemoteOption[]>;
  labels: RemoteSearchLabels;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  debounceMs?: number;
  /** Reports the search state so a form can, e.g., block submit while the list cannot load. */
  onStateChange?: (state: State) => void;
};

export type RemoteSearchState = "idle" | "loading" | "ready" | "error";
type State = RemoteSearchState;

export function RemoteSearchSelect({
  inputId, value, onChange, search, labels, disabled, invalid, describedBy, required, debounceMs = 250, onStateChange,
}: Props) {
  const autoId = useId();
  const id = inputId ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [options, setOptions] = useState<RemoteOption[]>([]);
  const [active, setActive] = useState(-1);
  const [nonce, setNonce] = useState(0);

  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  // Keep the visible text in step with an externally-set value.
  useEffect(() => { setText(value?.label ?? ""); }, [value]);

  // Debounced server search whenever the list is open and the query changes.
  const query = value ? "" : text.trim();
  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    setState("loading");
    const handle = setTimeout(() => {
      search(query, controller.signal)
        .then((rows) => { setOptions(rows); setState("ready"); setActive(-1); })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setOptions([]);
          setState("error");
        });
    }, debounceMs);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [open, query, nonce, search, disabled, debounceMs]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = useCallback((opt: RemoteOption) => {
    onChange(opt);
    setText(opt.label);
    setOpen(false);
    setActive(-1);
  }, [onChange]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && active >= 0 && options[active]) {
      e.preventDefault();
      choose(options[active]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          id={id}
          type="text"
          role="combobox"
          className="inp"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required ? true : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={labels.placeholder}
          value={text}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            // Typing after a selection discards it: the officer is searching again.
            if (value) onChange(null);
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          style={{ minHeight: 44, flex: 1 }}
        />
        {value ? (
          <button
            type="button"
            className="btn ghost"
            aria-label={labels.clear}
            onClick={() => { onChange(null); setText(""); setOpen(true); }}
            style={{ minHeight: 44 }}
          >
            x
          </button>
        ) : null}
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: "absolute", zIndex: 20, left: 0, right: 0, margin: "4px 0 0", padding: 4, listStyle: "none",
            maxHeight: 260, overflowY: "auto", background: "var(--card, #fff)", color: "var(--ink, #111827)",
            border: "1px solid var(--line, #d1d5db)", borderRadius: 8,
          }}
        >
          {state === "loading" ? <li role="presentation" style={{ padding: 8 }}>{labels.loading}</li> : null}
          {state === "error" ? (
            <li role="presentation" style={{ padding: 8 }}>
              <span role="alert">{labels.error}</span>{" "}
              <button type="button" className="link" style={{ textDecoration: "underline" }} onClick={() => setNonce((n) => n + 1)}>
                {labels.retry}
              </button>
            </li>
          ) : null}
          {state === "ready" && options.length === 0 ? <li role="presentation" style={{ padding: 8 }}>{labels.empty}</li> : null}
          {state === "ready" ? options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={value?.id === o.id}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              style={{ padding: "8px 10px", cursor: "pointer", borderRadius: 6, background: i === active ? "var(--hover, #eef2ff)" : undefined }}
            >
              {o.label}
              {o.hint ? <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{o.hint}</span> : null}
            </li>
          )) : null}
        </ul>
      ) : null}
    </div>
  );
}
