"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { minorToDecimalString } from "@/lib/money";

type Row = Record<string, unknown>;

export const UNKNOWN_OFFICE = "Unknown office";

/** Office display name; never an id fragment (see GAP-FINANCE-BUDGET-FUND-RELEASES-01). */
export function officeLabel(officeId: unknown, names?: ReadonlyMap<string, string>): string {
  const id = typeof officeId === "string" ? officeId : "";
  return (id && names?.get(id)) || UNKNOWN_OFFICE;
}

/** id -> name for every office the server named on these rows. */
export function officeNameMap(rows: ReadonlyArray<Record<string, unknown>>): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (typeof r.fromOfficeId === "string" && typeof r.fromOfficeName === "string" && r.fromOfficeName) m.set(r.fromOfficeId, r.fromOfficeName);
    if (typeof r.toOfficeId === "string" && typeof r.toOfficeName === "string" && r.toOfficeName) m.set(r.toOfficeId, r.toOfficeName);
  }
  return m;
}

const isInr = (currency: unknown) => currency == null || currency === "" || currency === "INR";

/**
 * GAP-FINANCE-BUDGET-FUND-RELEASES-03: the exact paise amount via formatMoney
 * (the old local rupees() divided a paise bigint as a float, dropped paise
 * below 1 lakh and could throw on a non-integer string). A non-INR release is
 * shown under its ISO code rather than a rupee sign. Bad input renders "—".
 */
export function releaseAmountLabel(amountMinor: unknown, currency: unknown): string {
  const money = formatMoney(amountMinor as string | number | bigint | null | undefined);
  if (isInr(currency) || money === "—") return money;
  return `${String(currency)} ${money.replace("₹", "")}`;
}

export function FundReleasesTable({ releases, source = "api" }: { releases: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>(
    "finance.fund-releases", releases, source, (d) => d.length === 0
  );

  // GAP-FINANCE-BUDGET-FUND-RELEASES-05: the CCY column only earns its width
  // when a non-rupee release is present.
  const allInr = rows.every((r) => isInr(r.currency));

  // GAP-FINANCE-BUDGET-FUND-RELEASES-01: names come from finance-service's office
  // directory (fromOfficeName / toOfficeName, null when the id is not in it).
  // An id with no name stays "Unknown office" -- never an id fragment, never a guess.
  const names = officeNameMap(rows);
  const enriched = rows.map((r) => ({
    ...r,
    _from: officeLabel(r.fromOfficeId, names),
    _to: officeLabel(r.toOfficeId, names),
  }));

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "fy",        label: "FY" },
          // csv: the full office id alongside the display name, so an export stays traceable.
          { key: "_from",     label: "From Office", render: (r) => <span title={String(r.fromOfficeId ?? "")}>{String(r._from)}</span>, csv: (r) => String(r.fromOfficeId ?? "") },
          { key: "_to",       label: "To Office",   render: (r) => <span title={String(r.toOfficeId ?? "")}>{String(r._to)}</span>, csv: (r) => String(r.toOfficeId ?? "") },
          // Sorts on the raw paise string; CSV carries the plain decimal.
          { key: "amountMinor", label: "Amount", align: "right", render: (r) => releaseAmountLabel(r.amountMinor, r.currency), csv: (r) => minorToDecimalString(r.amountMinor as string | number | null) ?? "" },
          ...(allInr ? [] : [{ key: "currency", label: "CCY" }]),
          // Raw status code on the pill + CSV; the pill humanizes it for display.
          { key: "status",    label: "Status", cellType: "status" as const },
          // IST calendar date on screen (a timestamptz sliced to 10 chars is the UTC date, a day early in IST); ISO in the CSV.
          { key: "effectiveFrom", label: "Effective", render: (r) => formatIndianDate(r.effectiveFrom as string | null | undefined), csv: (r) => String(r.effectiveFrom ?? "") },
        ]}
        rows={enriched}
        sortable
        filterable
        filterPlaceholder="Search releases…"
        pageSize={20}
        exportable
        csvPlainAmounts
        exportFilename="fund-releases"
        emptyIcon="💸"
        emptyTitle="No fund releases"
        emptyMessage="No allocation distributions found."
      />
    </>
  );
}
