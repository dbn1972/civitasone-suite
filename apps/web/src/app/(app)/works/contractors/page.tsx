import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "@/app/_components/ds";
import { maskPan, maskPhone } from "@/app/_components/ds/Masked";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWriteContractors } from "@/lib/works/roles";

type RawContractor = {
  id: string;
  name?: string;
  registrationNo?: string;
  pan?: string;
  phone?: string;
  performanceRating?: number | null;
  ratingCount?: number;
  active?: boolean;
} & Record<string, unknown>;

export type ContractorRow = {
  id: string;
  name: string;
  registrationNo: string;
  pan: string;
  phone: string;
  /** Raw rating for numeric sort; null when unrated (sorts consistently). */
  ratingValue: number | null;
  reviews: number;
  activeStatus: string;
};

/** Loader result + the server-reported total (meta.limit/offset), for the "first N of M" hint. */
type ContractorListResult = LoaderResult<ContractorRow[]> & { total: number | null };

const PAGE_SIZE = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapContractors(payload: unknown): ContractorRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;
  return rows.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const row = raw as RawContractor;
    if (typeof row.id !== "string") return [];
    const rawPan = row.pan ? String(row.pan) : "";
    const rawPhone = row.phone ? String(row.phone) : "";
    const perf = typeof row.performanceRating === "number" ? row.performanceRating : null;
    return [
      {
        id: row.id,
        name: String(row.name ?? "—"),
        registrationNo: String(row.registrationNo ?? "—"),
        // GAP-WORKS-CONTRACTORS-02 (PII/DPDP): never ship a full PAN/phone to
        // the register. Mask server-side-of-the-client here; the detail page
        // offers an audited reveal for authorised roles. Filtering still works
        // on the masked form (last-4 of PAN / last-3 of phone).
        pan: rawPan ? maskPan(rawPan) : "—",
        phone: rawPhone ? maskPhone(rawPhone) : "—",
        ratingValue: perf,
        reviews: typeof row.ratingCount === "number" ? row.ratingCount : 0,
        activeStatus: row.active !== false ? "active" : "inactive",
      },
    ];
  });
}

async function getContractors(): Promise<ContractorListResult> {
  const result = await fetchJson<unknown, ContractorRow[]>(
    `/api/v1/works/contractors?pageSize=${PAGE_SIZE}`,
    [],
    {
      telemetryKey: "works.contractors",
      mapResponse: mapContractors,
    },
  );
  return { ...result, total: null };
}

const columns: {
  key: keyof ContractorRow;
  label: string;
  cellType?: "status";
}[] = [
  { key: "name",           label: "Name" },
  { key: "registrationNo", label: "Reg. No." },
  { key: "pan",            label: "PAN" },
  { key: "phone",          label: "Phone" },
  { key: "ratingValue",    label: "Rating (/5)" },
  { key: "reviews",        label: "Reviews" },
  { key: "activeStatus",   label: "Status", cellType: "status" },
];

export default async function ContractorsPage() {
  const roles = getSessionRoles();
  const canWrite = canWriteContractors(roles);

  const { data: contractors, source, status, errorMessage } = await getContractors();

  // GAP-WORKS-CONTRACTORS-03 (FAILMASK): a failed fetch must not look like an
  // empty, healthy register (zeroed stat cards + "No contractors registered").
  if (source === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader
          title="Contractors"
          subtitle="Registered contractors available for tender quotations."
          back="/works"
          backLabel="Works & Billing"
        />
        <LoadErrorState
          result={{ status, errorMessage }}
          area="contractors"
          backHref="/works"
          backLabel="Works & Billing"
        />
      </div>
    );
  }

  const total      = contractors.length;
  const activeCount  = contractors.filter((c) => c.activeStatus === "active").length;
  const ratedCount   = contractors.filter((c) => c.ratingValue != null).length;
  const unratedCount = total - ratedCount;
  const atPageLimit  = total >= PAGE_SIZE;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Contractors"
        subtitle="Registered contractors available for tender quotations."
        back="/works"
        backLabel="Works & Billing"
        actions={
          canWrite ? (
            <Link
              href="/works/contractors/new"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Register contractor
            </Link>
          ) : undefined
        }
      />

      <StatGrid>
        <StatCard icon="🏢" iconBg="var(--infobg, #eff6ff)"  label="Total"    value={total} />
        <StatCard icon="✅" iconBg="var(--goodbg, #ecfdf3)"  label="Active"   value={activeCount} />
        <StatCard icon="⭐" iconBg="var(--warnbg, #fef3c7)"  label="Rated"    value={ratedCount} />
        <StatCard icon="🔲" iconBg="var(--panel, #f1f5f9)"   label="Unrated"  value={unratedCount} />
      </StatGrid>

      <Card title={`Contractors (${total}${atPageLimit ? "+" : ""})`}>
        {atPageLimit && (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
            Showing the first {PAGE_SIZE} contractors. Refine the filter to find more.
          </p>
        )}
        <DataTable<ContractorRow>
          columns={columns}
          rows={contractors}
          rowLinkKey="id"
          rowLinkPrefix="/works/contractors/"
          identifyingColumnKey="name"
          sortable
          filterable
          filterPlaceholder="Filter by name, registration…"
          pageSize={20}
          emptyIcon="🏢"
          emptyTitle="No contractors registered"
          emptyMessage="Add contractors to enable quotation and award workflows."
        />
      </Card>
    </div>
  );
}
