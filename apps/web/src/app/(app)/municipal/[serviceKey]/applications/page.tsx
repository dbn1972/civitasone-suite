import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Card, PageHeader, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { CitizenServiceLinks } from "../../_components/CitizenServiceLinks";
import { RecordsTable } from "../../_components/RecordsTable";
import { getMunicipalService } from "../../_data/services";
import { fetchMunicipalList } from "../../_data/municipalApi";
import { statusFilterOptions } from "../../_data/records";

export const dynamic = "force-dynamic";

type Props = {
  params: { serviceKey: string };
  searchParams?: { page?: string; status?: string; q?: string };
};

// GAP-...-APPLICATIONS-01: validate searchParams at the boundary (zod).
const searchParamsSchema = z.object({
  page: z.coerce.number().int().positive().catch(1),
  status: z.string().trim().min(1).max(40).optional(),
});

function withParams(serviceKey: string, params: { page?: number; status?: string }): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return `/municipal/${serviceKey}/applications${qs ? `?${qs}` : ""}`;
}

export default async function MunicipalApplicationsPage({ params, searchParams }: Props) {
  const config = getMunicipalService(params.serviceKey);
  if (!config) notFound();

  const parsed = searchParamsSchema.parse(searchParams ?? {});
  const page = parsed.page;
  const status = parsed.status;

  const statusFilters = statusFilterOptions(config);

  const { data: list, source, status: httpStatus } = await fetchMunicipalList(config, {
    page,
    ...(status ? { status } : {}),
  });

  const failed = source === "error";
  const total = list.meta.total;
  const pageSize = list.meta.pageSize || 20;
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total || firstRow + list.rows.length - 1);
  const hasPrev = page > 1;
  const hasNext = total > 0 ? page * pageSize < total : list.rows.length >= pageSize;

  return (
    <>
      <PageHeader
        title={`${config.label} — ${config.resourceLabel}`}
        // GAP-...-APPLICATIONS-04: subtitle is the service description, not the
        // raw gateway path (/api/v1/...).
        subtitle={config.description}
        back={`/municipal/${config.serviceKey}`}
        actions={
          config.citizenServiceKey ? (
            <Link href={`/citizen/services/${config.citizenServiceKey}/apply`} className="btn ghost">
              Citizen apply
            </Link>
          ) : null
        }
      />

      {config.citizenServiceKey ? (
        <div style={{ marginBottom: 16 }}>
          <CitizenServiceLinks config={config} />
        </div>
      ) : null}

      {/* GAP2-MUNICIPAL-APPLICATIONS-STATUS-01/-02: status filter driven by the
          service's real status vocabulary (statusFilterOptions), with humanized
          en labels — never a universal guessed set, and never raw snake_case.
          Services with no known vocabulary render no status tabs. */}
      {statusFilters.length > 0 ? (
        <div className="seg" role="tablist" style={{ marginBottom: 14, flexWrap: "wrap" }}>
          <Link role="tab" aria-selected={!status} className={!status ? "on" : undefined} href={withParams(config.serviceKey, {})}>
            All
          </Link>
          {statusFilters.map((s) => (
            <Link
              key={s.value}
              role="tab"
              aria-selected={status === s.value}
              className={status === s.value ? "on" : undefined}
              href={withParams(config.serviceKey, { status: s.value })}
            >
              {s.label}
            </Link>
          ))}
        </div>
      ) : null}

      {failed ? (
        <RefreshErrorState
          error={toHumanError(httpStatus === 403 ? "forbidden" : "load", { area: config.resourceLabel.toLowerCase() })}
          backHref={`/municipal/${config.serviceKey}`}
          source={{ status: httpStatus, area: config.resourceLabel.toLowerCase() }}
        />
      ) : (
        <Card title={config.resourceLabel}>
          <div className="pad">
            <RecordsTable config={config} rows={list.rows} />
            {total > 0 ? (
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 13, color: "var(--ink2)" }}
              >
                <span>
                  Showing {firstRow}–{lastRow} of {total}
                </span>
                <span style={{ display: "flex", gap: 10 }}>
                  {hasPrev ? (
                    <Link className="btn ghost" href={withParams(config.serviceKey, { status, page: page - 1 })}>
                      ← Prev
                    </Link>
                  ) : null}
                  {hasNext ? (
                    <Link className="btn ghost" href={withParams(config.serviceKey, { status, page: page + 1 })}>
                      Next →
                    </Link>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>
        </Card>
      )}
    </>
  );
}
