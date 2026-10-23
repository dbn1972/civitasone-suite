import Link from "next/link";
import { getTranslations } from "next-intl/server";
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

/** The mapped rows plus the server-reported size of the whole register (meta.total), for the "first N of M" hint. */
type ContractorList = { rows: ContractorRow[]; total: number | null };
type ContractorListResult = LoaderResult<ContractorList>;

/** works-service honours ?pageSize= (max 200) and reports the true register size in meta.total. */
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

/** meta.total from the list envelope, or null when the API did not send a usable one. */
function readServerTotal(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (!isRecord(meta)) return null;
  const total = (meta as { total?: unknown }).total;
  return typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : null;
}

function mapContractorList(payload: unknown): ContractorList | null {
  const rows = mapContractors(payload);
  return rows ? { rows, total: readServerTotal(payload) } : null;
}

async function getContractors(): Promise<ContractorListResult> {
  return fetchJson<unknown, ContractorList>(
    `/api/v1/works/contractors?pageSize=${PAGE_SIZE}`,
    { rows: [], total: null },
    {
      telemetryKey: "works.contractors",
      mapResponse: mapContractorList,
    },
  );
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

  const t = await getTranslations("works.contractors");
  const { data: list, source, status, errorMessage } = await getContractors();

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

  const contractors = list.rows;
  const shown        = contractors.length;
  // The register size comes from the server (meta.total). Without one, a full page is the only sign there may be more.
  const total        = Math.max(list.total ?? shown, shown);
  const truncated    = total > shown || (list.total === null && shown >= PAGE_SIZE);
  const activeCount  = contractors.filter((c) => c.activeStatus === "active").length;
  const ratedCount   = contractors.filter((c) => c.ratingValue != null).length;
  const unratedCount = shown - ratedCount;
  // Active / Rated / Unrated are counted over the rows actually loaded; say so when that is not the whole register.
  const partialHint  = truncated ? t("partialHint", { shown }) : undefined;

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
        <StatCard icon="🏢" iconBg="var(--infobg)"  label="Total"    value={total} />
        <StatCard icon="✅" iconBg="var(--goodbg)"  label="Active"   value={activeCount} hint={partialHint} />
        <StatCard icon="⭐" iconBg="var(--warnbg)"  label="Rated"    value={ratedCount} hint={partialHint} />
        <StatCard icon="🔲" iconBg="var(--panel)"   label="Unrated"  value={unratedCount} hint={partialHint} />
      </StatGrid>

      <Card title={`Contractors (${total}${total === shown && truncated ? "+" : ""})`}>
        {truncated && (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
            {total > shown ? t("showingFirstOfTotal", { shown, total }) : t("showingFirst", { shown })}
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
