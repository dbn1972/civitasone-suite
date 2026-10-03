"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, DataTable } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const NATURE_LABEL_KEYS: Record<string, string> = {
  accommodation: "natureAccommodation",
  car: "natureCar",
  loan: "natureLoan",
  medical: "natureMedical",
  club_membership: "natureClubMembership",
  gas_electricity_water: "natureGasElectricityWater",
  domestic_servant: "natureDomesticServant",
  education: "natureEducation",
  gift: "natureGift",
  other: "natureOther",
};

type PerquisiteLine = {
  sl: number;
  /** itemised component id (absent on the aggregate fall-back line, which has nothing to edit). */
  id?: string;
  nature: string;
  description?: string;
  valueByEmployerMinor?: number;
  amountRecoveredMinor?: number;
  taxableValueMinor: number;
  value: number;
} & Record<string, unknown>;

/**
 * GAP-PAYROLL-STATUTORY-PERQUISITE-06/07: a "use client" wrapper around
 * DataTable (page.tsx is a Server Component; `render` columns can't cross
 * that boundary). Two fixes:
 *
 *  - GAP-06: the API (statutory-returns/routes.ts GET form12ba) already
 *    returns valueByEmployerMinor/amountRecoveredMinor per line alongside
 *    taxableValueMinor -- this table now shows all three so the
 *    value-minus-recovered arithmetic is visible, not just the result.
 *  - GAP-07: nature was rendered raw from the API (e.g. "gas_electricity_
 *    water") in a hand-rolled `<table>` with no sort/filter/responsive
 *    behaviour; now mapped through the same NATURE_LABEL_KEYS used by
 *    PerquisiteComponentForm's own dropdown (shared translations, same
 *    namespace) and rendered via the shared ds DataTable, falling back to
 *    the raw string for any nature value outside the known set.
 */
export function PerquisiteTable({ perquisites, employeeId, fy, canModify = true }: {
  perquisites: PerquisiteLine[];
  employeeId: string;
  fy: string;
  /** hide the row actions for a read-only viewer. */
  canModify?: boolean;
}) {
  const t = useTranslations("perquisite");
  const tNature = useTranslations("perquisiteComponentForm");
  const router = useRouter();
  const [deleting, setDeleting] = useState<PerquisiteLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // GAP-PAYROLL-STATUTORY-PERQUISITE-06: edit = re-open the form on that
  // nature (saving upserts the same (employee, FY, nature) row); delete is a
  // separate, reason-required, audited command (POST .../:id/delete).
  async function confirmDelete(reason?: string) {
    if (!deleting?.id) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserJson(`v1/payroll/statutory/perquisite-components/${deleting.id}/delete`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setDeleting(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  const columns: {
    key: keyof PerquisiteLine & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount";
    render?: (row: PerquisiteLine) => React.ReactNode;
  }[] = [
    { key: "sl", label: t("colSl") },
    {
      key: "nature",
      label: t("colNature"),
      render: (r) => <>{NATURE_LABEL_KEYS[r.nature] ? tNature(NATURE_LABEL_KEYS[r.nature]!) : r.nature}</>,
    },
    { key: "description", label: t("colDescription"), render: (r) => <>{r.description || "—"}</> },
    { key: "valueByEmployerMinor", label: t("colValueByEmployer"), align: "right", cellType: "amount" },
    { key: "amountRecoveredMinor", label: t("colAmountRecovered"), align: "right", cellType: "amount" },
    { key: "taxableValueMinor", label: t("colTaxableValue"), align: "right", cellType: "amount" },
  ];
  if (canModify && perquisites.some((p) => p.id)) {
    columns.push({
      key: "id",
      label: t("colActions"),
      render: (r) => r.id ? (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <Link
            href={`/hr/payroll/statutory/perquisite?employeeId=${encodeURIComponent(employeeId)}&fy=${encodeURIComponent(fy)}&edit=${encodeURIComponent(r.id)}`}
            aria-label={t("editAria", { nature: NATURE_LABEL_KEYS[r.nature] ? tNature(NATURE_LABEL_KEYS[r.nature]!) : r.nature })}
          >
            {t("actionEdit")}
          </Link>
          <Button type="button" variant="ghost" onClick={() => { setError(undefined); setDeleting(r); }}
            aria-label={t("deleteAria", { nature: NATURE_LABEL_KEYS[r.nature] ? tNature(NATURE_LABEL_KEYS[r.nature]!) : r.nature })}>
            {t("actionDelete")}
          </Button>
        </span>
      ) : <>—</>,
    });
  }

  return (
    <>
      <DataTable<PerquisiteLine>
        columns={columns}
        rows={perquisites}
        pageSize={15}
        emptyIcon="📄"
        emptyTitle={t("noForm12baTitle")}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t("deleteTitle")}
        description={t("deleteDescription", { nature: deleting ? (NATURE_LABEL_KEYS[deleting.nature] ? tNature(NATURE_LABEL_KEYS[deleting.nature]!) : deleting.nature) : "" })}
        confirmLabel={t("deleteConfirm")}
        danger
        requireReason
        minReasonLength={5}
        maxReasonLength={500}
        reasonLabel={t("deleteReasonLabel")}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void confirmDelete(reason)}
        onCancel={() => !busy && setDeleting(null)}
      />
    </>
  );
}
