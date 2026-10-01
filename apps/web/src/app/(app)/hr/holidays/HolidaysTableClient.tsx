"use client";

/**
 * Client wrapper around DataTable for /hr/holidays.
 *
 * DataTable is itself a Client Component, and a `render` function prop
 * cannot cross the Server->Client boundary (the exact GAP-HR-EXPENSES-01
 * crash class -- see DataTable.tsx's own cellValue() guard). Keeping the
 * columns array (with its `render` for the actions cell) defined in THIS
 * client file, rather than passed down from the server page, avoids that
 * boundary entirely.
 */
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";
import { HolidayRowActions } from "./HolidayRowActions";
import type { Row } from "./page";

const TYPE_KEYS = new Set(["gazetted", "restricted", "optional", "weekly_off"]);

interface Props {
  rows: Row[];
  canManage: boolean;
}

export function HolidaysTableClient({ rows, canManage }: Props) {
  const t = useTranslations("holidays");

  const displayRows = rows.map((r) => ({
    ...r,
    typeLabel: TYPE_KEYS.has(r.type) ? t(`type.${r.type}`) : r.type,
  }));

  const columns: {
    key: string;
    label: string;
    cellType?: "date";
    render?: (row: Row & { typeLabel: string }) => React.ReactNode;
  }[] = [
    { key: "date", label: t("colDate"), cellType: "date" },
    { key: "day", label: t("colDay") },
    { key: "name", label: t("colHoliday") },
    { key: "typeLabel", label: t("colType") },
    { key: "applicableTo", label: t("colApplicableTo") },
  ];

  if (canManage) {
    columns.push({
      key: "id",
      label: t("colActions"),
      render: (row) => <HolidayRowActions id={row.id} name={row.name} />,
    });
  }

  return (
    <DataTable<Row & { typeLabel: string }>
      columns={columns}
      rows={displayRows}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      pageSize={15}
      emptyIcon="📅"
      emptyTitle={t("emptyTitle")}
      emptyMessage={t("emptyMessage")}
    />
  );
}
