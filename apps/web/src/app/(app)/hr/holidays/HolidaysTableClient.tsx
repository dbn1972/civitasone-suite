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
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AcceptedNotice, DataTable } from "../../../_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { HolidayRowActions } from "./HolidayRowActions";
import type { Row } from "./page";

const TYPE_KEYS = new Set(["gazetted", "restricted", "optional", "weekly_off"]);

interface Props {
  rows: Row[];
  canManage: boolean;
}

export function HolidaysTableClient({ rows, canManage }: Props) {
  const t = useTranslations("holidays");
  // GAP-HR-HOLIDAYS-06: DELETE is a queued write, so a successful 204 is
  // "received", not "gone" -- say so (and offer a manual refresh) rather than
  // leaving the row sitting there with no explanation.
  const accepted = useAcceptedWrite();
  const [lastDeleted, setLastDeleted] = useState("");

  const displayRows = rows.map((r) => ({
    ...r,
    typeLabel: TYPE_KEYS.has(r.type) ? t(`type.${r.type}`) : r.type,
    // "all" is the API's default code, not copy: show a translated label for
    // it and pass any free-text scope (the backend accepts any string) through.
    applicableToLabel: r.applicableTo.trim().toLowerCase() === "all" ? t("applicableToAll") : r.applicableTo,
  }));

  type DisplayRow = Row & { typeLabel: string; applicableToLabel: string };
  const columns: {
    key: string;
    label: string;
    cellType?: "date";
    render?: (row: DisplayRow) => React.ReactNode;
  }[] = [
    { key: "date", label: t("colDate"), cellType: "date" },
    { key: "day", label: t("colDay") },
    { key: "name", label: t("colHoliday") },
    { key: "typeLabel", label: t("colType") },
    { key: "applicableToLabel", label: t("colApplicableTo") },
  ];

  if (canManage) {
    columns.push({
      key: "id",
      label: t("colActions"),
      render: (row) => (
        <HolidayRowActions
          id={row.id}
          name={row.name}
          onQueued={(name) => {
            setLastDeleted(name);
            void accepted.accept();
          }}
        />
      ),
    });
  }

  return (
    <>
      <AcceptedNotice
        {...accepted.noticeProps}
        message={t("deleteSubmitted", { name: lastDeleted })}
      />
      <DataTable<DisplayRow>
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
    </>
  );
}
