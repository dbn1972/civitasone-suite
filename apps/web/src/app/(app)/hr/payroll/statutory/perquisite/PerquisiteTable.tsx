"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "../../../../../_components/ds";

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
export function PerquisiteTable({ perquisites }: { perquisites: PerquisiteLine[] }) {
  const t = useTranslations("perquisite");
  const tNature = useTranslations("perquisiteComponentForm");

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

  return (
    <DataTable<PerquisiteLine>
      columns={columns}
      rows={perquisites}
      pageSize={15}
      emptyIcon="📄"
      emptyTitle={t("noForm12baTitle")}
    />
  );
}
