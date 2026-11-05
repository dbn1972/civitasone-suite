"use client";

/**
 * AccountCombobox -- searchable head-of-account picker for journal lines (UX-R2, GAP-FINANCE-JOURNAL-ENTRY-04).
 *
 * Replaces the native <select> of opaque codes plus a separate "Filter accounts" box: the officer types part of a
 * code or a name ("cash", "2202") and picks from a list grouped by account type, each option reading
 * "code · name". Only the postable heads the form passes in are offered (active, leaf, not control accounts).
 *
 * ARIA 1.2 combobox (list autocomplete): the input has role=combobox, aria-expanded, aria-controls and
 * aria-activedescendant; ArrowDown/ArrowUp move, Enter picks, Escape closes and restores the chosen head,
 * Home/End jump. Typing an exact code picks it straight away. Free text that matches no head clears the choice,
 * so the form can never submit a code that is not in the chart.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AccountSummary } from "@civitasone/types";
import { formControlStyle } from "@/app/_components/ds/_formControlStyle";

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"] as const;
const TYPE_LABEL: Record<string, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };

/**
 * GAP-FINANCE-JOURNAL-ENTRY-04: postable accounts grouped by type (assets, liabilities, ...) and narrowed by the
 * typed text (code or name). The account already chosen is always kept so a filter never hides the selection.
 */
export function accountGroups(accounts: AccountSummary[], filter: string, selectedCode: string) {
  const q = filter.trim().toLowerCase();
  const shown = accounts.filter(
    (a) => !q || a.code === selectedCode || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
  );
  const types = [...TYPE_ORDER, ...Array.from(new Set(shown.map((a) => String(a.type)))).filter((t) => !(TYPE_ORDER as readonly string[]).includes(t))];
  return types
    .map((type) => ({ type, label: TYPE_LABEL[type] ?? type, accounts: shown.filter((a) => String(a.type) === type) }))
    .filter((g) => g.accounts.length > 0);
}

export function accountOptionLabel(a: Pick<AccountSummary, "code" | "name">): string {
  return `${a.code} · ${a.name}`;
}

export interface AccountComboboxProps {
  id: string;
  accounts: AccountSummary[];
  /** Chosen account code, or "". */
  value: string;
  onChange: (code: string) => void;
  "aria-label": string;
  invalid?: boolean;
  describedBy?: string;
}

export function AccountCombobox({ id, accounts, value, onChange, "aria-label": ariaLabel, invalid, describedBy }: AccountComboboxProps) {
  const listId = useId();
  const selected = accounts.find((a) => a.code === value) ?? null;
  const [text, setText] = useState(selected ? accountOptionLabel(selected) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Follow a value set from outside (reset, default heads) unless the officer is typing.
  useEffect(() => {
    if (!open) setText(selected ? accountOptionLabel(selected) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync on the chosen code only.
  }, [value]);

  // While the text still shows the chosen head, list everything (the officer is browsing, not searching).
  const query = selected && text === accountOptionLabel(selected) ? "" : text;
  const groups = useMemo(() => accountGroups(accounts, query, ""), [accounts, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.accounts), [groups]);
  const optId = (code: string) => `${listId}-opt-${code.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  function pick(a: AccountSummary) {
    onChange(a.code);
    setText(accountOptionLabel(a));
    setOpen(false);
  }

  function onType(next: string) {
    setText(next);
    setOpen(true);
    setActive(0);
    const t = next.trim().toLowerCase();
    const exact = accounts.find((a) => a.code.toLowerCase() === t || accountOptionLabel(a).toLowerCase() === t);
    if (exact) onChange(exact.code);
    else if (value) onChange("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(Math.max(0, flat.findIndex((a) => a.code === value))); return; }
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home" && open) {
      e.preventDefault(); setActive(0);
    } else if (e.key === "End" && open) {
      e.preventDefault(); setActive(Math.max(0, flat.length - 1));
    } else if (e.key === "Enter") {
      if (open && flat[active]) { e.preventDefault(); pick(flat[active]!); }
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); setOpen(false); setText(selected ? accountOptionLabel(selected) : text); }
    }
  }

  const activeCode = open ? flat[active]?.code : undefined;
  // Keep the keyboard-highlighted option visible inside the 280px list (a real chart of accounts is longer).
  useEffect(() => {
    if (!activeCode) return;
    const el = document.getElementById(optId(activeCode));
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optId is a pure function of listId.
  }, [activeCode]);
  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 0 }}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeCode ? optId(activeCode) : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder="Type a code or name, e.g. cash"
        value={text}
        onChange={(e) => onType(e.target.value)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (e.relatedTarget instanceof Node && wrapRef.current?.contains(e.relatedTarget)) return;
          setOpen(false);
          if (!value) return;
          if (selected) setText(accountOptionLabel(selected));
        }}
        style={{ ...formControlStyle }}
      />
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={`${ariaLabel}: matching heads of account`}
          style={{
            position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, marginTop: 2,
            maxHeight: 280, overflowY: "auto", background: "var(--panel)", border: "1px solid var(--control-border, var(--line))",
            borderRadius: 10, boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)", fontSize: 13,
          }}
        >
          {flat.length === 0 ? (
            <div role="presentation" style={{ padding: "10px 12px", color: "var(--ink2)" }}>No postable head of account matches “{text.trim()}”.</div>
          ) : (
            groups.map((g) => {
              const gid = `${listId}-g-${g.type}`;
              return (
                <div key={g.type} role="group" aria-labelledby={gid}>
                  <div id={gid} role="presentation" style={{ padding: "6px 12px 2px", fontSize: 11.5, fontWeight: 700, color: "var(--ink2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {g.label}
                  </div>
                  {g.accounts.map((a) => {
                    const isActive = a.code === activeCode;
                    return (
                      // ARIA combobox (aria-activedescendant pattern): focus stays on the input, which owns every key
                      // (ArrowUp/Down, Home/End, Enter, Escape); options are deliberately not focusable, and the click
                      // is the pointer path only.
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                      <div
                        key={a.code}
                        id={optId(a.code)}
                        role="option"
                        data-code={a.code}
                        aria-selected={a.code === value}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(a)}
                        style={{
                          padding: "8px 12px", cursor: "pointer", minHeight: 24,
                          background: isActive ? "var(--primary-soft, var(--line))" : undefined,
                          fontWeight: a.code === value ? 700 : 400,
                        }}
                      >
                        <span className="mono">{a.code}</span> · {a.name}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
