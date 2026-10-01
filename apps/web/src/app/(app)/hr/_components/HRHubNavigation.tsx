"use client";

/**
 * HRHubNavigation — categorized, searchable module navigation.
 *
 * Replaces the flat 72-tile wall with:
 * - A search box at the top (find any module instantly; "/" focuses it,
 *   Enter opens the first match)
 * - Grouped categories with expand/collapse (collapsed set persisted per
 *   browser in localStorage)
 * - "Quick Access": the tiles this browser opened most recently, topped up
 *   with a static starter list. Nothing server-side is measured, so this is
 *   "recent", not "most-used" (GAP-HR-HOME-02).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavTile } from "@civitasone/types";

type Category = { title: string; icon: string; tiles: NavTile[] };

/** Static starter list; fills Quick Access until the user has real recents. */
const QUICK_ACCESS_DEFAULT_HREFS = [
  "/hr/dashboard",
  "/hr/employees",
  "/hr/leave",
  "/hr/attendance",
  "/hr/payroll",
  "/hr/recruitment",
];
const QUICK_ACCESS_MAX = 6;
/** Above this many tiles, only the first two categories start expanded. */
const AUTO_COLLAPSE_TILE_THRESHOLD = 40;
const COLLAPSED_STORAGE_KEY = "hr-hub-collapsed";
const RECENTS_STORAGE_KEY = "hr-hub-recents";

function readStoredList(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

function writeStoredList(key: string, value: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota): the preference is simply not remembered */
  }
}

/** Pure: recents first (only hrefs that still exist), then defaults, deduped, capped. */
export function buildQuickAccessHrefs(recents: string[], known: Set<string>): string[] {
  const out: string[] = [];
  for (const href of [...recents, ...QUICK_ACCESS_DEFAULT_HREFS]) {
    if (known.has(href) && !out.includes(href)) out.push(href);
    if (out.length === QUICK_ACCESS_MAX) break;
  }
  return out;
}

/** Pure: default collapsed set for a first visit (nothing stored yet). */
export function defaultCollapsedTitles(categories: Category[]): string[] {
  const total = categories.reduce((sum, c) => sum + c.tiles.length, 0);
  if (total <= AUTO_COLLAPSE_TILE_THRESHOLD) return [];
  return categories.slice(2).map((c) => c.title);
}

/**
 * Turns a (possibly translated) category title into a DOM-id-safe slug:
 * lowercase, any run of non-alphanumeric characters (spaces, "&", etc.)
 * becomes a single "-", and leading/trailing dashes are trimmed. Titles come
 * from per-locale message files, so two categories could in principle
 * collide once slugified (e.g. differing only by punctuation) — callers
 * must still combine this with a positional suffix (see `categoryPanelId`)
 * rather than relying on the slug alone to be unique.
 */
function slugifyCategoryTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic, DOM-id-safe id for a category's collapsible panel. */
function categoryPanelId(title: string, index: number): string {
  return `cat-${slugifyCategoryTitle(title)}-${index}`;
}

export function HRHubNavigation({ categories }: { categories: Category[] }) {
  const t = useTranslations("hr");
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  // Initial state is computed without touching localStorage so the server
  // render and first client render agree; the stored value is applied after
  // mount (see effect below).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(defaultCollapsedTitles(categories)));
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    const stored = readStoredList(COLLAPSED_STORAGE_KEY);
    if (stored) setCollapsed(new Set(stored));
    setRecents(readStoredList(RECENTS_STORAGE_KEY) ?? []);
  }, []);

  // "/" focuses the search box unless the user is already typing somewhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const allTiles = useMemo(() => {
    const seen = new Set<string>();
    return categories.flatMap((c) => c.tiles).filter((tile) => (seen.has(tile.href) ? false : (seen.add(tile.href), true)));
  }, [categories]);

  const tileByHref = useMemo(() => new Map(allTiles.map((tile) => [tile.href, tile])), [allTiles]);

  const quickAccessTiles = useMemo(
    () =>
      buildQuickAccessHrefs(recents, new Set(tileByHref.keys()))
        .map((href) => tileByHref.get(href))
        .filter((tile): tile is NavTile => tile !== undefined),
    [recents, tileByHref],
  );

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        tiles: cat.tiles.filter(
          (tile) =>
            tile.title.toLowerCase().includes(q) ||
            (tile.description?.toLowerCase().includes(q) ?? false),
        ),
      }))
      .filter((cat) => cat.tiles.length > 0);
  }, [categories, search]);

  // A tile can be listed under more than one category; search results show
  // each destination once (first category wins).
  const searchResults = useMemo(() => {
    const seen = new Set<string>();
    return filteredCategories.flatMap((cat) =>
      cat.tiles
        .filter((tile) => (seen.has(tile.href) ? false : (seen.add(tile.href), true)))
        .map((tile) => ({ tile, categoryTitle: cat.title })),
    );
  }, [filteredCategories]);

  const toggleCategory = (title: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      writeStoredList(COLLAPSED_STORAGE_KEY, [...next]);
      return next;
    });
  };

  const recordVisit = useCallback((href: string) => {
    setRecents((prev) => {
      const next = [href, ...prev.filter((h) => h !== href)].slice(0, QUICK_ACCESS_MAX);
      writeStoredList(RECENTS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const isSearching = search.trim().length > 0;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Search */}
      <div style={{ position: "relative" }}>
        <span
          aria-hidden="true"
          style={{ position: "absolute", insetInlineStart: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}
        >
          🔍
        </span>
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && searchResults[0]) {
              e.preventDefault();
              recordVisit(searchResults[0].tile.href);
              router.push(searchResults[0].tile.href);
            }
          }}
          placeholder={t("hubSearchPlaceholder")}
          aria-label={t("hubSearchLabel")}
          style={{
            width: "100%",
            padding: "12px 14px 12px 40px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            fontSize: 14,
            minHeight: 48,
            background: "var(--bg)",
          }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label={t("hubClearSearch")}
            style={{
              position: "absolute",
              insetInlineEnd: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              color: "var(--mut)",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      {/* Quick Access (shown when not searching) */}
      {!isSearching && (
        <section>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--mut)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t("hubQuickAccess")}
          </h2>
          <div className="grid g-3" style={{ gap: 10 }}>
            {quickAccessTiles.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href}
                onClick={() => recordVisit(tile.href)}
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
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--mut)", marginBottom: 10 }}>
            {t("hubResultsFor", { count: searchResults.length, query: search })}
          </h2>
          <div className="grid g-4" style={{ gap: 10 }}>
            {searchResults.map(({ tile, categoryTitle }) => (
              <Link
                key={tile.href}
                href={tile.href}
                onClick={() => recordVisit(tile.href)}
                className="mtile"
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <h3 className="v">{tile.title}</h3>
                {tile.description && <div className="l">{tile.description}</div>}
                <div className="l" style={{ fontSize: "0.6875rem", color: "var(--mut)", marginTop: 2 }}>{categoryTitle}</div>
              </Link>
            ))}
          </div>
          {searchResults.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--mut)", padding: "32px 0" }}>
              <p>{t("hubNoMatch", { query: search })}</p>
              {quickAccessTiles.length > 0 && (
                <p style={{ marginTop: 8 }}>
                  {quickAccessTiles.slice(0, 3).map((tile, i) => (
                    <span key={tile.href}>
                      {i > 0 && " · "}
                      <Link href={tile.href} onClick={() => recordVisit(tile.href)}>{tile.title}</Link>
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
        </section>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {categories.map((cat, catIndex) => {
            const isOpen = !collapsed.has(cat.title);
            const panelId = categoryPanelId(cat.title, catIndex);
            return (
              <section key={cat.title} style={{ borderRadius: 10, border: "1px solid var(--line)", overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => toggleCategory(cat.title)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 16px",
                    background: isOpen ? "var(--line2)" : "var(--bg)",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--ink)",
                    textAlign: "start",
                  }}
                >
                  <span aria-hidden="true">{cat.icon}</span>
                  <span style={{ flex: 1 }}>{cat.title}</span>
                  <span style={{ fontSize: 11, color: "var(--mut)", fontWeight: 400 }}>{t("hubItemsCount", { count: cat.tiles.length })}</span>
                  <span aria-hidden="true" style={{ fontSize: 12, color: "var(--mut)", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
                </button>
                {isOpen && (
                  <div
                    id={panelId}
                    className="grid g-4"
                    style={{ padding: "8px 12px 12px", gap: 8 }}
                  >
                    {cat.tiles.map((tile) => (
                      <Link
                        key={`${cat.title}-${tile.href}`}
                        href={tile.href}
                        onClick={() => recordVisit(tile.href)}
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
