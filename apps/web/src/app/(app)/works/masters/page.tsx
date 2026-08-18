import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { MasterCreateForm } from "./MasterCreateForm";

// ─── Master type catalogue ────────────────────────────────────────────────────

const MASTER_TYPES = [
  "authorities",
  "work-types",
  "work-sub-types",
  "proposer-types",
  "programs",
  "publication-levels",
  "repair-types",
  "schemes",
  "scopes",
  "tender-types",
  "user-departments",
  "contractor-classes",
  "issue-types",
  "issue-description-types",
  "assets",
  "work-description-types",
  "sr-items",
] as const;

type MasterType = (typeof MASTER_TYPES)[number];

function isMasterType(v: string): v is MasterType {
  return (MASTER_TYPES as readonly string[]).includes(v);
}

function humanizeMaster(prefix: string): string {
  const map: Record<string, string> = {
    "authorities": "Authorities",
    "work-types": "Work Types",
    "work-sub-types": "Work Sub-Types",
    "proposer-types": "Proposer Types",
    "programs": "Programs",
    "publication-levels": "Publication Levels",
    "repair-types": "Repair Types",
    "schemes": "Schemes",
    "scopes": "Scopes",
    "tender-types": "Tender Types",
    "user-departments": "User Departments",
    "contractor-classes": "Contractor Classes",
    "issue-types": "Issue Types",
    "issue-description-types": "Issue Description Types",
    "assets": "Assets",
    "work-description-types": "Work Description Types",
    "sr-items": "SR Items",
  };
  return map[prefix] ?? prefix;
}

// ─── Display row type (server-mapped, serialisable for DataTable) ─────────────

type DisplayRow = {
  shortId: string;
  name: string;
  code: string;
  active: string;
};

const columns: { key: keyof DisplayRow; label: string }[] = [
  { key: "shortId", label: "ID" },
  { key: "name",    label: "Name" },
  { key: "code",    label: "Code" },
  { key: "active",  label: "Active" },
];

// ─── Nav styles ───────────────────────────────────────────────────────────────

const navItemBase: React.CSSProperties = {
  display: "block",
  padding: "9px 14px",
  fontSize: 13,
  textDecoration: "none",
  borderBottom: "1px solid var(--line)",
  transition: "background 0.1s",
};

const navItemActive: React.CSSProperties = {
  ...navItemBase,
  fontWeight: 600,
  background: "var(--primary)",
  color: "var(--primary-fg, #fff)",
};

const navItemDefault: React.CSSProperties = {
  ...navItemBase,
  color: "var(--text)",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MastersPage({
  searchParams,
}: {
  searchParams?: { type?: string };
}) {
  const rawType = searchParams?.type ?? "authorities";
  if (!isMasterType(rawType)) notFound();
  const type: MasterType = rawType;

  const { data: items } = await fetchJson<unknown, Record<string, unknown>[]>(
    `/api/v1/works/masters/${type}?pageSize=100`,
    [],
    {
      telemetryKey: `works.masters.${type}`,
      mapResponse: (p) => {
        if (p && typeof p === "object" && "data" in p) {
          const d = (p as { data: unknown }).data;
          return Array.isArray(d) ? (d as Record<string, unknown>[]) : [];
        }
        return Array.isArray(p) ? (p as Record<string, unknown>[]) : [];
      },
    },
  );

  const rows: DisplayRow[] = items.map((item) => ({
    shortId: String(item.id ?? "").slice(0, 8),
    name:    String(item.name ?? "—"),
    code:    item.code != null ? String(item.code) : "—",
    active:  item.active != null ? (item.active ? "Yes" : "No") : "—",
  }));

  const typeLabel = humanizeMaster(type);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Masters Registry"
        subtitle="Configure lookup values used across the works lifecycle."
        back="/works"
        backLabel="Works & Billing"
      />

      <div
        style={{
          display: "flex",
          gap: 24,
          alignItems: "flex-start",
          marginTop: 20,
        }}
      >
        {/* ── Left nav ─────────────────────────────── */}
        <nav
          aria-label="Master types"
          style={{
            width: 220,
            flexShrink: 0,
            border: "1px solid var(--line)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {MASTER_TYPES.map((mt) => (
            <Link
              key={mt}
              href={`/works/masters?type=${mt}`}
              style={mt === type ? navItemActive : navItemDefault}
              aria-current={mt === type ? "page" : undefined}
            >
              {humanizeMaster(mt)}
            </Link>
          ))}
        </nav>

        {/* ── Right content ─────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Create form (renders a button that expands inline) */}
          <MasterCreateForm masterType={type} />

          <div style={{ marginTop: 16 }}>
            <Card title={`${typeLabel} (${rows.length})`}>
              <DataTable<DisplayRow>
                columns={columns}
                rows={rows}
                sortable
                filterable
                filterPlaceholder={`Filter ${typeLabel.toLowerCase()}…`}
                pageSize={25}
                emptyIcon="📂"
                emptyTitle={`No ${typeLabel.toLowerCase()} yet`}
                emptyMessage="Use the form above to add the first entry."
                caption={`${typeLabel} master registry list`}
              />
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
