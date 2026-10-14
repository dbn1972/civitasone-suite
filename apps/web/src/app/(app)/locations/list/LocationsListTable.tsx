"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserFacingError } from "@/lib/userFacingError";
import { useFormError } from "@/lib/useFormError";
import { ActionButton, Card, DataTable } from "../../../_components/ds";
import type { LocationRow } from "../_data";

type Row = LocationRow & Record<string, unknown>;

/**
 * GAP-LOCATIONS-LIST-01/02: the offices & branches register. Real columns
 * (name, type, parent, LGD code, status) and no raw-id column. Archive calls
 * PATCH /v1/locations/:id/archive, which refuses while active sub-locations
 * exist and records the reason in the audit event; those refusals surface as
 * catalogued copy, never the raw response.
 */
function RowArchive({ row }: { row: Row }) {
  const t = useTranslations("locationRowActions");
  const router = useRouter();
  const formError = useFormError("location");

  async function archive(reason?: string) {
    const res = await fetch(`/api/proxy/v1/locations/${encodeURIComponent(row.id)}/archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });
    if (!res.ok) {
      const code = await res.clone().json().then((b: { code?: string }) => b.code ?? null).catch(() => null);
      if (code === "HAS_ACTIVE_CHILDREN") throw new Error(t("errHasActiveChildren"));
      if (code === "ALREADY_ARCHIVED") throw new Error(t("errAlreadyArchived"));
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
    }
    router.refresh();
  }

  if (row.status === "archived") return null;
  return (
    <ActionButton
      label={t("archive")}
      className="btn ghost"
      danger
      requireReason
      reasonLabel={t("reasonLabel")}
      confirmTitle={t("confirmTitle")}
      confirmDescription={t("confirmDescription", { name: row.name })}
      confirmLabel={t("confirmLabel")}
      onConfirm={archive}
      onSuccess={() => router.refresh()}
    />
  );
}

export function LocationsListTable({ rows, canManage }: { rows: LocationRow[]; canManage: boolean }) {
  const t = useTranslations("locationsList");
  const typeLabel = (type: string) => (["state", "district", "block", "ward", "office", "facility", "branch"].includes(type) ? t(`types.${type}` as "types.state") : type);
  return (
    <Card title={t("cardTitle")}>
      <DataTable<Row>
        columns={[
          { key: "name", label: t("colName") },
          { key: "type", label: t("colType"), render: (row) => typeLabel(row.type) },
          { key: "parentName", label: t("colParent"), render: (row) => row.parentName || "—" },
          { key: "lgdCode", label: t("colLgd"), render: (row) => row.lgdCode || "—" },
          { key: "status", label: t("colStatus"), render: (row) => (row.status === "archived" ? t("statusArchived") : t("statusActive")) },
          ...(canManage ? [{ key: "actions", label: "", render: (row: Row) => <RowArchive row={row} /> }] : []),
        ]}
        rows={rows as Row[]}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        emptyIcon="📍"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />
    </Card>
  );
}
