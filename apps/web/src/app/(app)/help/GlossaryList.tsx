"use client";

import { useMemo, useState } from "react";
import type { GlossaryRow } from "@/lib/glossary";

/**
 * Searchable, jump-to-letter glossary list for the Help Centre
 * (GAP-HELP-HOME-02). Replaces the long flat <dl> that was hard to scan on a
 * phone. Pure presentation: the rows are prepared server-side with
 * collapseGlossary() so an abbreviation and its expansion appear as one row
 * ("Head of Account (HoA)"), and the shared tooltip lookups are untouched.
 */
export function GlossaryList({ rows }: { rows: GlossaryRow[] }) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.term.toLowerCase().includes(q) ||
        (r.alias?.toLowerCase().includes(q) ?? false) ||
        r.definition.toLowerCase().includes(q),
    );
  }, [rows, q]);

  // First letters present in the FILTERED set, for the A–Z jump bar.
  const letters = useMemo(() => {
    const set = new Set<string>();
    for (const r of filtered) set.add(r.term.charAt(0).toUpperCase());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [filtered]);

  function letterId(letter: string) {
    return `gloss-${letter}`;
  }

  return (
    <div>
      <label style={{ display: "block", marginBottom: 10 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 650, marginBottom: 4 }}>
          Search words
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a word, e.g. voucher"
          className="input"
          style={{ width: "100%", maxWidth: 320 }}
          aria-describedby="gloss-count"
        />
      </label>

      {letters.length > 0 && (
        <nav aria-label="Jump to a letter" style={{ marginBottom: 14 }}>
          <ul
            style={{
              listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6,
              padding: 0, margin: 0,
            }}
          >
            {letters.map((letter) => (
              <li key={letter}>
                <a
                  href={`#${letterId(letter)}`}
                  className="btn ghost sm"
                  style={{ padding: "2px 9px", fontWeight: 650 }}
                >
                  {letter}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <p id="gloss-count" aria-live="polite" style={{ margin: "0 0 10px", color: "var(--mut)", fontSize: 12.5 }}>
        {filtered.length === 0
          ? "No words match"
          : `${filtered.length} word${filtered.length === 1 ? "" : "s"}`}
      </p>

      {filtered.length > 0 && (
        <dl style={{ margin: 0, display: "grid", gap: 12 }}>
          {filtered.map((r, i) => {
            const letter = r.term.charAt(0).toUpperCase();
            const prev = i > 0 ? filtered[i - 1].term.charAt(0).toUpperCase() : null;
            const isFirstOfLetter = letter !== prev;
            return (
              <div key={r.term} id={isFirstOfLetter ? letterId(letter) : undefined}>
                <dt style={{ fontWeight: 700, fontSize: 14 }}>
                  {r.term}
                  {r.alias ? ` (${r.alias})` : ""}
                </dt>
                <dd style={{ margin: "2px 0 0", color: "var(--ink)", lineHeight: 1.5 }}>
                  {r.definition}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
