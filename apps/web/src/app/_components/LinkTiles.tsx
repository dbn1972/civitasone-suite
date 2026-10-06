import Link from "next/link";
import type { CSSProperties } from "react";
import type { NavTile } from "@civitasone/types";
import { StatIcon } from "./ds/StatIcon";
import { StatusPill } from "./ds/StatusPill";

interface LinkTilesProps {
  tiles: NavTile[];
  columns?: "three" | "four" | "auto";
}

const TILE_ICONS: Record<string, string> = {
  Dashboard: "📊",
  Employees: "👥",
  Attendance: "📅",
  "Leave Management": "🌴",
  "Apply Leave": "📝",
  "Payroll Runs": "💰",
  "Salary Slips": "🧾",
  Recruitment: "📢",
  Appraisals: "⭐",
  "Training Programs": "🎓",
  "Org Chart": "🌳",
  "Chart of Accounts": "📒",
  "Budget Formulation": "📈",
  Sanctions: "🖊️",
  "Bill Processing": "🧾",
  Advances: "💸",
  "Utilization Certificates": "📋",
  "General Ledger": "📗",
  "New Voucher": "➕",
  "Financial Statements": "📊",
  Payments: "💳",
  Orders: "📦",
  Vendors: "🏢",
  Indents: "📑",
  Tenders: "🏛️",
  Projects: "🏗️",
  Grants: "🎁",
  Assets: "🖥️",
  Stock: "📦",
  CRM: "🤝",
  Helpdesk: "🎫",
  Citizen: "🏛️",
  Audit: "🔍",
  Legal: "⚖️",
  Reports: "📄",
  Knowledge: "📚",
  Notifications: "🔔",
  Workflow: "🔁",
  // GAP-IDENTITY-HOME-01: the identity hub's seven tiles previously all fell
  // through to the 📁 default (no title matched, and no identity href matched
  // the href heuristics below), giving the hub no visual differentiation
  // between users, sessions, keys and emergency access. Distinct icons per
  // tile title:
  Users: "👤",
  Sessions: "🖥️",
  "API keys": "🔑",
  "Break-glass": "🚨",
  WebAuthn: "🔐",
  "MFA (admin)": "📱",
  "SSO (admin)": "🪪",
  // GAP-BILLING-HOME-03: the billing hub tiles (Plans, Subscriptions, Invoices,
  // GSTN Console) had no TILE_ICONS entry and no matching href substring, so
  // all fell through to the generic 📁 folder glyph. Keyed by their hub labels
  // (ModuleHub links in billing/page.tsx). "Payments" already maps to 💳 above.
  Plans: "📋",
  Subscriptions: "🔁",
  Invoices: "🧾",
  "GSTN Console": "🏛️",
  // GAP-TELEPHONY-HOME-04: the telephony hub tiles ("Call Log", "Agent Queue",
  // "Dispositions") had no TILE_ICONS entry and no matching href substring, so
  // all fell through to the generic 📁 folder glyph. Keyed by their hub labels
  // (ModuleHub links in telephony/page.tsx).
  "Call Log": "📞",
  "Agent Queue": "🎧",
  Dispositions: "🗂",
  // GAP-CATALOGUE-HOME-04: the Service Catalogue hub's four tiles (Products,
  // Categories, Rates, Bundles) had no TILE_ICONS entry and no matching href
  // substring, so all four fell through to the generic 📁 folder glyph with no
  // visual differentiation. Keyed by their hub titles (catalogue/page.tsx).
  Products: "📦",
  Categories: "🗂",
  Rates: "💵",
  Bundles: "🎁",
  // GAP-FIELD-HOME-01: the Field hub's five tiles (Tasks, Visits, Routes,
  // Agents, Offline Sync) matched no title key and no href heuristic below, so
  // all five fell through to the generic 📁 folder glyph — the hub had no
  // visual cue to tell the lists apart. Distinct icons per tile title.
  Tasks: "✅",
  Visits: "📍",
  Routes: "🧭",
  Agents: "👷",
  "Offline Sync": "🔄",
  // GAP-LOYALTY-HOME-02: the loyalty hub's five tiles previously all fell
  // through to the 📁 default (no title matched and no loyalty href matched
  // the href heuristics below). The loyalty hub now sets each tile's own
  // `icon` (NavTile.icon, preferred), but these keyed fallbacks give the same
  // distinct glyphs to any other caller that lists a loyalty tile without an
  // explicit icon.
  Programs: "🏆",
  Members: "👤",
  Accruals: "➕",
  Redemptions: "🎁",
  Tiers: "🏅",
};

const TILE_BG = ["#eef2ff", "#ecfdf3", "#fffaeb", "#fce7ee", "#e7edfd", "#f1f5f9"];

function tileIcon(tile: NavTile): string {
  if (tile.icon) return tile.icon;
  if (TILE_ICONS[tile.title]) return TILE_ICONS[tile.title]!;
  if (tile.href.includes("dashboard")) return "📊";
  if (tile.href.includes("employees")) return "👥";
  if (tile.href.includes("leave")) return "🌴";
  if (tile.href.includes("payroll")) return "💰";
  if (tile.href.includes("procurement") || tile.href.includes("orders")) return "📦";
  return "📁";
}

export function LinkTiles({ tiles, columns = "three" }: LinkTilesProps) {
  const gridClass = columns === "four" ? "g-4" : columns === "auto" ? "g-auto" : "g-3";

  // Group tiles by their `section` label, preserving insertion order.
  const sections: Array<{ label: string | null; tiles: NavTile[] }> = [];
  for (const tile of tiles) {
    const label = tile.section ?? null;
    const last = sections[sections.length - 1];
    if (last && last.label === label) {
      last.tiles.push(tile);
    } else {
      sections.push({ label, tiles: [tile] });
    }
  }

  let tileIndex = 0;

  return (
    <>
      {sections.map((sec, si) => (
        <div key={sec.label ?? `s${si}`} className="lt-section">
          {sec.label && (
            <h2 className="lt-section-hd" aria-label={sec.label}>{sec.label}</h2>
          )}
          <div className={`grid ${gridClass}`}>
            {sec.tiles.map((tile) => {
              const idx = tileIndex++;
              return (
                <Link
                  key={tile.href}
                  href={tile.href}
                  className="mtile"
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  {/* GAP-IDENTITY-HOME-01: the pastel is set via a CSS custom
                      property rather than a hard `background` so the dark theme
                      can override it ( .dark .mtile .ic { --tile-ic-bg: … } in
                      civitas-ds.css) instead of being stuck with a light pastel
                      that is unreadable on a dark panel. */}
                  <div
                    className="ic"
                    style={{ "--tile-ic-bg": TILE_BG[idx % TILE_BG.length], background: "var(--tile-ic-bg)" } as CSSProperties}
                  >
                    <StatIcon icon={tileIcon(tile)} size={18} />
                  </div>
                  <h3 className="v">{tile.title}</h3>
                  {tile.badge ? (
                    <div style={{ margin: "2px 0 6px" }}>
                      <StatusPill status={tile.badge.tone === "warn" ? "pending" : "info"} label={tile.badge.text} />
                    </div>
                  ) : null}
                  {tile.description ? <div className="l">{tile.description}</div> : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
