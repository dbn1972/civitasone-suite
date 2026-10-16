"use client";
import Link from "next/link";
import { DataTable } from "@/app/_components/ds";

type Row = { id: string; title: string; passing: string; duration: string; attempts: number; status: string; courseRef: string };

export function AssessmentsTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable<Row>
      columns={[
        { key: "title", label: "Assessment" },
        { key: "passing", label: "Passing score", align: "right" },
        { key: "duration", label: "Duration", align: "right" },
        { key: "attempts", label: "Max attempts", align: "right" },
        { key: "status", label: "Status", cellType: "status" },
        {
          key: "courseRef",
          label: "Course",
          sortable: false,
          render: (r: Row) =>
            r.courseRef ? (
              <Link href={"/learning/courses/" + r.courseRef} className="btn ghost" style={{ fontSize: "0.8125rem", padding: "2px 10px" }}>
                View course
              </Link>
            ) : (
              <span style={{ color: "var(--ink2)" }}>—</span>
            ),
        },
      ]}
      rows={rows}
      rowLinkKey="id"
      rowLinkPrefix="/learning/assessments/"
      identifyingColumnKey="title"
      sortable
      filterable
      filterPlaceholder="Filter assessments…"
      pageSize={15}
    />
  );
}
