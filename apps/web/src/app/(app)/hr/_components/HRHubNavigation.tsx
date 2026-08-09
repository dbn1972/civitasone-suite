"use client";

/**
 * HRHubNavigation — categorized, searchable module navigation.
 *
 * Replaces the flat 72-tile wall with:
 * - A search box at the top (find any module instantly)
 * - Grouped categories with expand/collapse
 * - "Quick Access" showing the 6 most-used modules
 * - Smooth animation on expand/collapse
 */

import Link from "next/link";
import { useState, useMemo } from "react";
import type { NavTile } from "@civitasone/types";

type Category = { title: string; icon: string; tiles: NavTile[] };

const QUICK_ACCESS_HREFS = [
  "/hr/dashboard",
  "/hr/employees",
  "/hr/leave",
  "/hr/attendance",
  "/hr/payroll",
  "/hr/recruitment",
];

export function HRHubNavigation({ categories }: { categories: Category[] }) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const allTiles = useMemo(
    () => categories.flatMap((c) => c.tiles),
    [categories],
  );

  const quickAccessTiles = useMemo(
    () => allTiles.filter((t) => QUICK_ACCESS_HREFS.includes(t.href)),
    [allTiles],
  );

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        tiles: cat.tiles.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.description?.toLowerCase().includes(q) ?? false),
        ),
      }))
      .filter((cat) => cat.tiles.length > 0);
  }, [categories, search]);

  const toggleCategory = (title: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const isSearching = search.trim().length > 0;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Search */}
      <div style={{ position: "relative" }}>
        <span
          aria-hidden="true"
          style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}
        >
          🔍
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search modules… (e.g. leave, payroll, attendance)"
          aria-label="Search HR modules"
          style={{
            width: "100%",
            padding: "12px 14px 12px 40px",
            borderRadius: 10,
            border: "1px solid var(--line, #e2e8f0)",
            fontSize: 14,
            minHeight: 48,
            background: "#fff",
          }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              color: "#94a3b8",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Quick Access (shown when not searching) */}
      {!isSearching && (
        <section>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ink2, #64748b)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Quick Access
          </h2>
          <div className="grid g-3" style={{ gap: 10 }}>
            {quickAccessTiles.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href}
                className="mtile"
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <h3 className="v">{tile.title}</h3>
                {tile.description && <div className="l">{tile.description}</div>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Search results or categorized navigation */}
      {isSearching ? (
        <section>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ink2, #64748b)", marginBottom: 10 }}>
            {filteredCategories.reduce((sum, c) => sum + c.tiles.length, 0)} results for &ldquo;{search}&rdquo;
          </h2>
          <div className="grid g-4" style={{ gap: 10 }}>
            {filteredCategories.flatMap((cat) =>
              cat.tiles.map((tile) => (
                <Link
                  key={tile.href}
                  href={tile.href}
                  className="mtile"
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <h3 className="v">{tile.title}</h3>
                  {tile.description && <div className="l">{tile.description}</div>}
                  <div className="l" style={{ fontSize: "0.6875rem", color: "#94a3b8", marginTop: 2 }}>{cat.title}</div>
                </Link>
              )),
            )}
          </div>
          {filteredCategories.length === 0 && (
            <p style={{ textAlign: "center", color: "#94a3b8", padding: "32px 0" }}>
              No modules match &ldquo;{search}&rdquo;. Try a different term.
            </p>
          )}
        </section>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {categories.map((cat) => {
            const isOpen = !collapsed.has(cat.title);
            return (
              <section key={cat.title} style={{ borderRadius: 10, border: "1px solid var(--line, #e2e8f0)", overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => toggleCategory(cat.title)}
                  aria-expanded={isOpen}
                  aria-controls={`cat-${cat.title}`}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 16px",
                    background: isOpen ? "#f8fafc" : "#fff",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--ink, #1e293b)",
                    textAlign: "left",
                  }}
                >
                  <span aria-hidden="true">{cat.icon}</span>
                  <span style={{ flex: 1 }}>{cat.title}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>{cat.tiles.length} items</span>
                  <span aria-hidden="true" style={{ fontSize: 12, color: "#94a3b8", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
                </button>
                {isOpen && (
                  <div
                    id={`cat-${cat.title}`}
                    className="grid g-4"
                    style={{ padding: "8px 12px 12px", gap: 8 }}
                  >
                    {cat.tiles.map((tile) => (
                      <Link
                        key={tile.href}
                        href={tile.href}
                        className="mtile"
                        style={{ textDecoration: "none", color: "inherit", display: "block" }}
                      >
                        <h3 className="v">{tile.title}</h3>
                        {tile.description && <div className="l">{tile.description}</div>}
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
