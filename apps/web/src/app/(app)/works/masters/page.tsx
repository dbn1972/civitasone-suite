import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { getMasterMeta } from "../_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { WORKS_MASTERS_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { MastersTable, type MasterItem, type ParentOption } from "./MastersTable";
import {
  MASTER_TYPES,
  isMasterType,
  humanizeMaster,
  PARENT_FIELD,
  type MasterType,
} from "./masterTypes";

async function fetchMaster(type: MasterType) {
  return fetchJson<unknown, Record<string, unknown>[]>(
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
}

export default async function MastersPage({
  searchParams,
}: {
  searchParams?: { type?: string };
}) {
  const rawType = searchParams?.type ?? "authorities";
  if (!isMasterType(rawType)) notFound();
  const type: MasterType = rawType;

  const { data: items, source } = await fetchMaster(type);
  const failed = source === "error";
  // GAP2-WORKS-MASTERS-09: the true tenant-wide total for this master type, so
  // the table can warn "showing first N of M" when a type has more rows than
  // the page cap (backend meta.total is now correct — GAP2-WORKS-APPROVALS-05).
  const { data: typeMeta } = await getMasterMeta(type);

  // GAP-WORKS-MASTERS-02: create/edit/deactivate controls are admin-only (the
  // works-service POST/PATCH already 403 everyone else). getSessionRoles reads
  // the session JWT server-side; the server remains the real authority.
  const canManage = WORKS_MASTERS_ADMIN_ROLES.some((r) => getSessionRoles().includes(r));

  // GAP-WORKS-MASTERS-03: for a type that references a parent master, fetch the
  // parent list so the create/edit form offers a name picker (not a raw UUID
  // box) and the table can show the parent NAME instead of an id prefix.
  const parent = PARENT_FIELD[type];
  let parentOptions: ParentOption[] = [];
  if (parent && !failed) {
    const { data: parentItems } = await fetchMaster(parent.optionsType);
    parentOptions = parentItems
      .filter((p) => typeof p.id === "string")
      .map((p) => ({
        id: String(p.id),
        label: String(p.name ?? p.keyword ?? p.code ?? p.id),
      }));
  }

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Masters Registry"
        subtitle="Configure lookup values used across the works lifecycle."
        back="/works"
        backLabel="Works & Billing"
      />

      <div className="masters-layout">
        {/* ── Left nav ─────────────────────────────── */}
        <nav aria-label="Master types" className="masters-nav">
          {MASTER_TYPES.map((mt) => (
            <Link
              key={mt}
              href={`/works/masters?type=${mt}`}
              className={mt === type ? "masters-nav-item active" : "masters-nav-item"}
              aria-current={mt === type ? "page" : undefined}
              style={navItemStyle(mt === type)}
            >
              {humanizeMaster(mt)}
            </Link>
          ))}
        </nav>

        {/* ── Right content ─────────────────────────── */}
        <div className="masters-content">
          <MastersTable
            masterType={type}
            items={items as MasterItem[]}
            failed={failed}
            canManage={canManage}
            parentOptions={parentOptions}
            total={typeMeta.total}
          />
        </div>
      </div>
    </div>
  );
}

// Per-link visual styling kept inline (the responsive column behaviour is in
// civitas-ds.css .masters-layout/.masters-nav — GAP-WORKS-MASTERS-06).
function navItemStyle(active: boolean): React.CSSProperties {
  return {
    display: "block",
    padding: "9px 14px",
    fontSize: 13,
    textDecoration: "none",
    borderBottom: "1px solid var(--line)",
    fontWeight: active ? 600 : undefined,
    background: active ? "var(--primary)" : undefined,
    color: active ? "var(--primary-fg, #fff)" : "var(--text)",
  };
}
