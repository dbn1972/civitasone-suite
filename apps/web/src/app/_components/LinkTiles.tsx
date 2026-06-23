import Link from "next/link";
import type { NavTile } from "@civitasone/types";

interface LinkTilesProps {
  tiles: NavTile[];
  columns?: "three" | "four";
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
};

const TILE_BG = ["#eef2ff", "#ecfdf3", "#fffaeb", "#fce7ee", "#e7edfd", "#f1f5f9"];

function tileIcon(tile: NavTile): string {
  if (TILE_ICONS[tile.title]) return TILE_ICONS[tile.title]!;
  if (tile.href.includes("dashboard")) return "📊";
  if (tile.href.includes("employees")) return "👥";
  if (tile.href.includes("leave")) return "🌴";
  if (tile.href.includes("payroll")) return "💰";
  if (tile.href.includes("procurement") || tile.href.includes("orders")) return "📦";
  return "📁";
}

export function LinkTiles({ tiles, columns = "three" }: LinkTilesProps) {
  const gridClass = columns === "four" ? "g-4" : "g-3";

  return (
    <div className={`grid ${gridClass}`}>
      {tiles.map((tile, i) => (
        <Link
          key={tile.href}
          href={tile.href}
          className="mtile"
          style={{ textDecoration: "none", color: "inherit", display: "block" }}
        >
          <div className="ic" style={{ background: TILE_BG[i % TILE_BG.length] }}>
            {tileIcon(tile)}
          </div>
          <h3 className="v">{tile.title}</h3>
          {tile.description ? <div className="l">{tile.description}</div> : null}
        </Link>
      ))}
    </div>
  );
}
